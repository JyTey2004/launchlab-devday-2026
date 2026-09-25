// Dedicated demo host. Customer code runs only in its own CodeBuild project.
const ref = (name) => ({ Ref: name }), att = (name, value) => ({ 'Fn::GetAtt': [name, value] });
const sub = (value) => ({ 'Fn::Sub': value });
const allow = (Action, Resource, Condition) => ({ Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
const policy = (Statement) => ({ Version: '2012-10-17', Statement });
const trust = (service) => policy([{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: service } }]);
const arn = (service, path) => sub(`arn:aws:${service}:\${AWS::Region}:\${AWS::AccountId}:${path}`);
const roleArn = sub('arn:aws:iam::${AWS::AccountId}:role/llh-*');
const tag = [{ Key: 'project', Value: 'LaunchLabHosted' }];

export function hostedTemplate() {
  return {
    AWSTemplateFormatVersion: '2010-09-09', Description: 'LaunchLab invite-only workflow API and durable worker',
    Parameters: { ImageId: { Type: 'AWS::EC2::Image::Id' } },
    Resources: {
      Vpc: { Type: 'AWS::EC2::VPC', Properties: { CidrBlock: '10.74.0.0/16', EnableDnsHostnames: true, EnableDnsSupport: true, Tags: tag } },
      Gateway: { Type: 'AWS::EC2::InternetGateway', Properties: { Tags: tag } },
      Attachment: { Type: 'AWS::EC2::VPCGatewayAttachment', Properties: { VpcId: ref('Vpc'), InternetGatewayId: ref('Gateway') } },
      Subnet: { Type: 'AWS::EC2::Subnet', Properties: { VpcId: ref('Vpc'), CidrBlock: '10.74.1.0/24', AvailabilityZone: { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] }, Tags: tag } },
      RouteTable: { Type: 'AWS::EC2::RouteTable', Properties: { VpcId: ref('Vpc'), Tags: tag } },
      Route: { Type: 'AWS::EC2::Route', DependsOn: 'Attachment', Properties: { RouteTableId: ref('RouteTable'), DestinationCidrBlock: '0.0.0.0/0', GatewayId: ref('Gateway') } },
      RouteAssociation: { Type: 'AWS::EC2::SubnetRouteTableAssociation', Properties: { SubnetId: ref('Subnet'), RouteTableId: ref('RouteTable') } },
      SecurityGroup: { Type: 'AWS::EC2::SecurityGroup', Properties: { GroupDescription: 'LaunchLab HTTPS only; administration via SSM', VpcId: ref('Vpc'), SecurityGroupIngress: [80, 443].map((port) => ({ IpProtocol: 'tcp', FromPort: port, ToPort: port, CidrIp: '0.0.0.0/0' })), Tags: tag } },
      Releases: { Type: 'AWS::S3::Bucket', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }, VersioningConfiguration: { Status: 'Enabled' },
        LifecycleConfiguration: { Rules: [{ Id: 'ExpireOldReleases', Status: 'Enabled', NoncurrentVersionExpiration: { NoncurrentDays: 14 } }] }, Tags: tag,
      } },
      ModelSecret: { Type: 'AWS::SecretsManager::Secret', DeletionPolicy: 'Retain', Properties: { Description: 'LaunchLab hosted OpenAI runtime configuration; populated separately', Tags: tag } },
      BuildBoundary: { Type: 'AWS::IAM::ManagedPolicy', Properties: { Description: 'Maximum privileges for LaunchLab customer build and collector roles', PolicyDocument: policy([
        allow(['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:GetBucketLocation', 's3:ListBucket'], ['arn:aws:s3:::llh-*', 'arn:aws:s3:::llh-*/*']),
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'], [arn('logs', 'log-group:/aws/codebuild/llh-*'), arn('logs', 'log-group:/aws/lambda/llh-*')]),
        allow(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'], arn('dynamodb', 'table/llh-*')),
        allow(['cloudwatch:GetMetricData'], '*'),
      ]) } },
      ProvisionRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: trust('cloudformation.amazonaws.com'), Policies: [{ PolicyName: 'CreateLaunchLabEnvironments', PolicyDocument: policy([
        allow(['s3:CreateBucket', 's3:DeleteBucket', 's3:Get*', 's3:List*', 's3:PutBucket*', 's3:PutEncryptionConfiguration', 's3:PutLifecycleConfiguration'], ['arn:aws:s3:::llh-*', 'arn:aws:s3:::llh-*/*']),
        allow(['logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:DescribeLogGroups', 'logs:PutRetentionPolicy', 'logs:TagResource', 'logs:ListTagsForResource', 'logs:TagLogGroup'], '*'),
        allow(['codebuild:CreateProject', 'codebuild:UpdateProject', 'codebuild:DeleteProject', 'codebuild:BatchGetProjects'], arn('codebuild', 'project/llh-*')),
        allow(['dynamodb:CreateTable', 'dynamodb:DescribeTable', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable', 'dynamodb:UpdateTimeToLive', 'dynamodb:DescribeTimeToLive', 'dynamodb:TagResource', 'dynamodb:ListTagsOfResource'], arn('dynamodb', 'table/llh-*')),
        allow(['lambda:CreateFunction', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:DeleteFunction', 'lambda:UpdateFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:AddPermission', 'lambda:RemovePermission', 'lambda:TagResource', 'lambda:ListTags', 'lambda:GetPolicy'], arn('lambda', 'function:llh-*')),
        allow(['amplify:CreateApp', 'amplify:CreateBranch', 'amplify:GetApp', 'amplify:GetBranch', 'amplify:DeleteApp', 'amplify:DeleteBranch', 'amplify:TagResource', 'amplify:ListTagsForResource'], arn('amplify', 'apps/*')),
        allow(['apigateway:POST', 'apigateway:GET', 'apigateway:PATCH', 'apigateway:DELETE', 'apigateway:PUT', 'apigateway:TagResource'], sub('arn:aws:apigateway:${AWS::Region}::/apis*')),
        allow(['apigateway:GET', 'apigateway:POST', 'apigateway:PUT', 'apigateway:DELETE'], sub('arn:aws:apigateway:${AWS::Region}::/tags*')),
        allow(['iam:CreateRole'], roleArn, { StringEquals: { 'iam:PermissionsBoundary': ref('BuildBoundary') } }),
        allow(['iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:GetRolePolicy', 'iam:GetRole', 'iam:DeleteRole', 'iam:TagRole'], roleArn),
        allow(['iam:PassRole'], roleArn, { StringEquals: { 'iam:PassedToService': ['lambda.amazonaws.com', 'codebuild.amazonaws.com'] } }),
      ]) }] } },
      HostRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: trust('ec2.amazonaws.com'), ManagedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'], Policies: [{ PolicyName: 'LaunchLabRuntime', PolicyDocument: policy([
        allow(['s3:GetObject'], sub('${Releases.Arn}/releases/*')),
        allow(['s3:PutObject'], sub('${Releases.Arn}/backups/*')),
        allow(['secretsmanager:GetSecretValue'], ref('ModelSecret')),
        allow(['cloudformation:CreateStack', 'cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents'], arn('cloudformation', 'stack/llh-*/*')),
        allow(['iam:PassRole'], att('ProvisionRole', 'Arn'), { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } }),
        allow(['s3:PutObject', 's3:GetObject'], 'arn:aws:s3:::llh-*/*'),
        // BatchGetBuilds authorizes against the project ARN, not a build ARN.
        allow(['codebuild:StartBuild', 'codebuild:ListBuildsForProject', 'codebuild:BatchGetBuilds'], arn('codebuild', 'project/llh-*')),
        allow(['amplify:UpdateApp', 'amplify:CreateDeployment', 'amplify:StartDeployment', 'amplify:GetJob'], arn('amplify', 'apps/*')),
      ]) }] } },
      InstanceProfile: { Type: 'AWS::IAM::InstanceProfile', Properties: { Roles: [ref('HostRole')] } },
      Host: { Type: 'AWS::EC2::Instance', DependsOn: 'Route', Properties: {
        ImageId: ref('ImageId'), InstanceType: 't4g.small', IamInstanceProfile: ref('InstanceProfile'),
        NetworkInterfaces: [{ DeviceIndex: '0', AssociatePublicIpAddress: false, SubnetId: ref('Subnet'), GroupSet: [ref('SecurityGroup')] }],
        MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
        CreditSpecification: { CPUCredits: 'standard' },
        BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 20, VolumeType: 'gp3', Encrypted: true, DeleteOnTermination: false } }],
        Tags: [...tag, { Key: 'Name', Value: 'LaunchLab hosted demo' }],
      } },
      Address: { Type: 'AWS::EC2::EIP', DependsOn: 'Attachment', Properties: { Domain: 'vpc', Tags: tag } },
      AddressAssociation: { Type: 'AWS::EC2::EIPAssociation', Properties: { AllocationId: att('Address', 'AllocationId'), InstanceId: ref('Host') } },
    },
    Outputs: { InstanceId: { Value: ref('Host') }, PublicIp: { Value: ref('Address') }, ReleaseBucket: { Value: ref('Releases') }, ModelSecretArn: { Value: ref('ModelSecret') }, CloudFormationRoleArn: { Value: att('ProvisionRole', 'Arn') }, RoleBoundaryArn: { Value: ref('BuildBoundary') } },
  };
}
