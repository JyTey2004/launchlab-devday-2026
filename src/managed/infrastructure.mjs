import { publicExperiment } from './experiment-config.mjs';
const ref = (name) => ({ Ref: name });
const att = (name, value) => ({ 'Fn::GetAtt': [name, value] });
const sub = (value) => ({ 'Fn::Sub': value });
const trust = (service) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: service } }] });
const policy = (Statement) => ({ Version: '2012-10-17', Statement });
const allow = (Action, Resource) => ({ Effect: 'Allow', Action, Resource });

export function securityHeaders(apiBase) {
  return JSON.stringify({ customHeaders: [{ pattern: '**/*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'${apiBase ? ' ' + apiBase : ''}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` },
  ] }] });
}

export function infrastructure(run, collector) {
  const name = run.resourceName;
  const origin = sub('https://preview.${App.DefaultDomain}');
  const tags = [{ Key: 'project', Value: 'LaunchLab' }, { Key: 'deployment', Value: run.id }, ...(run.hosting?.cloudFormationRoleArn ? [{ Key: 'LaunchLabHosted', Value: 'service-v1' }] : [])];
  const boundary = run.hosting?.roleBoundaryArn ? { PermissionsBoundary: run.hosting.roleBoundaryArn } : {};
  return { AWSTemplateFormatVersion: '2010-09-09', Description: 'Isolated LaunchLab repository build, preview and experiment',
    Parameters: Object.fromEntries(['PreviewPassword', 'ReportTokenHash', 'SessionSecret'].map((key) => [key, { Type: 'String', NoEcho: true, MinLength: 24 }])),
    Resources: {
      Assets: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireBuildArtifacts', Status: 'Enabled', ExpirationInDays: 7, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] }, Tags: tags,
      } },
      BuildLogs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: `/aws/codebuild/${name}`, RetentionInDays: 7 } },
      BuildRole: { Type: 'AWS::IAM::Role', Properties: { ...boundary, AssumeRolePolicyDocument: trust('codebuild.amazonaws.com'), Policies: [{ PolicyName: 'ProjectBuildOnly', PolicyDocument: policy([
        allow(['s3:GetObject', 's3:PutObject', 's3:GetObjectVersion'], sub('${Assets.Arn}/*')),
        allow(['s3:GetBucketLocation', 's3:ListBucket'], att('Assets', 'Arn')),
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'], att('BuildLogs', 'Arn')),
      ]) }] } },
      Builder: { Type: 'AWS::CodeBuild::Project', Properties: { Name: name, ServiceRole: att('BuildRole', 'Arn'), TimeoutInMinutes: 10, QueuedTimeoutInMinutes: 5, ConcurrentBuildLimit: 1,
        Environment: { Type: 'LINUX_CONTAINER', ComputeType: 'BUILD_GENERAL1_SMALL', Image: 'aws/codebuild/standard:7.0', PrivilegedMode: false },
        Source: { Type: 'S3', Location: sub('${Assets}/source.zip'), BuildSpec: JSON.stringify({ version: 0.2, phases: {
          install: { 'runtime-versions': { nodejs: Number(run.recipe.nodeMajor) } }, build: { commands: ['node .launchlab/build-worker.mjs'] },
        }, artifacts: { files: ['**/*'], 'base-directory': 'delivery' } }) },
        Artifacts: { Type: 'S3', Location: ref('Assets'), Name: 'build.zip', Packaging: 'ZIP', NamespaceType: 'BUILD_ID', Path: 'outputs', EncryptionDisabled: false },
        LogsConfig: { CloudWatchLogs: { Status: 'ENABLED', GroupName: ref('BuildLogs') } }, Tags: tags,
      } },
      App: { Type: 'AWS::Amplify::App', Properties: { Name: name, Platform: 'WEB', Description: `LaunchLab ${run.id}`,
        BasicAuthConfig: { EnableBasicAuth: true, Username: 'launchlab', Password: ref('PreviewPassword') },
        CustomHeaders: securityHeaders(), Tags: tags,
      } },
      Branch: { Type: 'AWS::Amplify::Branch', Properties: { AppId: att('App', 'AppId'), BranchName: 'preview', EnableAutoBuild: false, Stage: 'DEVELOPMENT',
        BasicAuthConfig: { EnableBasicAuth: true, Username: 'launchlab', Password: ref('PreviewPassword') } } },
      Records: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true }, OnDemandThroughput: { MaxReadRequestUnits: 20, MaxWriteRequestUnits: 10 },
        SSESpecification: { SSEEnabled: true }, Tags: tags,
      } },
      Logs: { Type: 'AWS::Logs::LogGroup', Properties: { LogGroupName: `/aws/lambda/${name}`, RetentionInDays: 7 } },
      CollectorRole: { Type: 'AWS::IAM::Role', Properties: { ...boundary, AssumeRolePolicyDocument: trust('lambda.amazonaws.com'), Policies: [{ PolicyName: 'ProjectFeedbackOnly', PolicyDocument: policy([
        allow(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'], att('Records', 'Arn')),
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'], att('Logs', 'Arn')), allow(['cloudwatch:GetMetricData'], '*'),
      ]) }] } },
      Collector: { Type: 'AWS::Lambda::Function', Properties: { FunctionName: name, Runtime: 'python3.13', Handler: 'index.handler', Role: att('CollectorRole', 'Arn'),
        MemorySize: 256, Timeout: 20, Code: { ZipFile: collector + '\nEXPERIMENT = json.loads(' + JSON.stringify(JSON.stringify(publicExperiment(run) || {})) + ')\n' }, Environment: { Variables: {
          PROJECT_ID: run.id, HYPOTHESIS: run.input.hypothesis, GOAL_EVENT: run.input.goalEvent, TABLE_NAME: ref('Records'), STORE_ORIGIN: origin,
          AMPLIFY_APP_ID: att('App', 'AppId'), REPORT_TOKEN_SHA256: ref('ReportTokenHash'), SESSION_SECRET: ref('SessionSecret'),
        } }, Tags: tags,
      } },
      Api: { Type: 'AWS::ApiGatewayV2::Api', Properties: { Name: name, ProtocolType: 'HTTP', CorsConfiguration: { AllowOrigins: [origin], AllowMethods: ['GET', 'POST', 'OPTIONS'], AllowHeaders: ['content-type', 'authorization'], MaxAge: 600 } } },
      Integration: { Type: 'AWS::ApiGatewayV2::Integration', Properties: { ApiId: ref('Api'), IntegrationType: 'AWS_PROXY', IntegrationUri: att('Collector', 'Arn'), PayloadFormatVersion: '2.0', TimeoutInMillis: 25000 } },
      Route: { Type: 'AWS::ApiGatewayV2::Route', Properties: { ApiId: ref('Api'), RouteKey: '$default', Target: { 'Fn::Join': ['/', ['integrations', ref('Integration')]] } } },
      Stage: { Type: 'AWS::ApiGatewayV2::Stage', Properties: { ApiId: ref('Api'), StageName: '$default', AutoDeploy: true, DefaultRouteSettings: { ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 } } },
      Invoke: { Type: 'AWS::Lambda::Permission', Properties: { FunctionName: ref('Collector'), Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*') } },
    },
    Outputs: { Bucket: { Value: ref('Assets') }, Builder: { Value: ref('Builder') }, AppId: { Value: att('App', 'AppId') }, Url: { Value: origin }, ApiBase: { Value: att('Api', 'ApiEndpoint') }, Table: { Value: ref('Records') } },
  };
}
