import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as LambdaEventSource from 'aws-cdk-lib/aws-lambda-event-sources';
import * as Lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class EmailServiceCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //create SQS
    const inquiryQueue = new sqs.Queue(this, 'inquiryProcessingQueue', {
      visibilityTimeout: cdk.Duration.seconds(45),
      queueName: 'inquiry-processing-queue'
    })

    //create an SQS event source
    const lambdaSqsEventSource = new LambdaEventSource.SqsEventSource(inquiryQueue, {
      batchSize: 10,
      enabled: true
    });

    const processInquiryFunction = new Lambda.Function(this, "ProcessQI", {
      code: Lambda.Code.fromAsset("lambdas"),
      handler: 'handler.processInquiry',
      runtime: Lambda.Runtime.NODEJS_22_X
    })

    //attach the event source to the order Processing lambda
    processInquiryFunction.addEventSource(lambdaSqsEventSource);

    // create policy statement
    const iamPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:*'],
      resources: ['*'],
      sid: 'SendEmailPolicySid'
    })

    //grant lambda permissions to invoke SES
    processInquiryFunction.addToRolePolicy(iamPolicy)


    //provision the dynamodb
    const inquiryTable = new dynamodb.Table(this, 'InquieryTbl', {
        partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING},
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.DEFAULT,
        pointInTimeRecovery: false
    })

    //EnquiryFunction
    const createInquiryFunction = new Lambda.Function(this, "CreateInquiry", {
      code: Lambda.Code.fromAsset("lambdas"),
      handler: 'handler.createInquiry',
      runtime: Lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        INQUIRY_TABLE_NAME: inquiryTable.tableName,
        INQUIRY_PROCESSING_QUEUE_URL: inquiryQueue.queueUrl,
        ADMIN_EMAIL: 'YOUR_ADMIN_EMAIL'
      }
    })

    inquiryTable.grantReadWriteData(createInquiryFunction)
    inquiryQueue.grantSendMessages(createInquiryFunction)

    //create api gateway
    const restApi = new apigateway.RestApi(this, 'EmailServiceApi', {
      restApiName: 'EmailService'
    })

    // create api integration
    const apiIntegration = new apigateway.LambdaIntegration(createInquiryFunction)

    const newInquiries = restApi.root.addResource('inquiries');
    newInquiries.addMethod('POST', apiIntegration, { authorizationType: apigateway.AuthorizationType.NONE });

  }
}
