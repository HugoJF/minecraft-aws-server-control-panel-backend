# Minecraft server control panel (backend)

The function in this repository can be used to control the [CloudFormation stack from a Minecraft server](https://github.com/HugoJF/minecraft-aws-server-control-panel-template) directly from a web page, avoiding the need to create AWS accounts and all the hassle related to starting and stopping the servers.

This project also contains an AFK detector that will automatically turn off the server after 15 minutes without any players in it, avoiding extra costs.

#### The API **DOES NOT** have any authorization and/or authentication, it can be used by ANYONE at ANY TIME. This project is focused towards tiny communities, and the API URL SHOULD NEVER BE SHARED PUBLICLY!

## Prerequisites

1. NodeJS installed
2. AWS CLI configured with credentials with enough permissions to deploy Lambda functions, S3 Buckets, CloudFormation stacks, etc 
3. Serverless Framework globally installed.
4. Minecraft server stack already deployed.

## Deploying

Update the `.env` file with the following information:

#### Environment variables

- **`STACK_ARN`**: CloudFormation stack ARN;
- **`CLUSTER_ARN`**: ECS cluster ARN (check the resources created by the stack);
- **`ROLE_ARN`**: What role should be used to update the stack.
- **`SERVER_HOST`**: Minecraft server domain name;
- **`AWS_REGION`**: Which AWS region that was used to deploy the server stack;
- **`TABLE_NAME`**: The DynamoDB table that is deployed in order to track how long the server is empty.

Deployment is done via the command:
```bash
$ serverless deploy
```

