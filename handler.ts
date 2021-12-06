import * as AWS from 'aws-sdk';
import * as Gamedig from 'gamedig';

const stackArn = process.env.STACK_ARN as string;
const clusterArn = process.env.CLUSTER_ARN as string;
const serverHost = process.env.SERVER_HOST as string;
const awsRegion = process.env.AWS_REGION as string;

const cf = new AWS.CloudFormation({
    region: awsRegion,
});

const ecs = new AWS.ECS({
    region: awsRegion,
})

async function updateServerState(state) {
    if (!['Stopped', 'Running'].includes(state)) {
        throw new Error(`${state} is not a valid state`);
    }

    const stack = await cf.describeStacks({
        StackName: stackArn,
    }).promise()

    const template = await cf.getTemplate({
        StackName: stackArn,
    }).promise()

    if (!stack?.Stacks?.[0]) {
        throw new Error('Could not find stack');
    }

    const parameters = stack.Stacks[0].Parameters ?? [];
    const constantParameters = parameters.filter(parameter => parameter.ParameterKey !== 'ServerState');

    return await cf.updateStack({
        StackName: stackArn,
        TemplateBody: template.TemplateBody,
        Capabilities: ['CAPABILITY_IAM'],
        Parameters: [
            ...constantParameters, {
                ParameterKey: 'ServerState',
                ParameterValue: state,
            }]
    }).promise()
}

module.exports.off = async () => {
    await updateServerState('Stopped')

    return {
        statusCode: 204,
    };
}

module.exports.on = async () => {
    await updateServerState('Running')

    return {
        statusCode: 204,
    };
}

module.exports.status = async () => {
    const stacks$ = cf.describeStacks({
        StackName: stackArn,
    }).promise()

    const clusters$ = ecs.describeClusters({
        clusters: [clusterArn],
    }).promise()

    const query$ = Gamedig.query({
        type: 'minecraft',
        host: serverHost,
        socketTimeout: 100,
        attemptTimeout: 300,
    }).catch(() => null)

    const [stacks, clusters, query] = await Promise.all([stacks$, clusters$, query$]);

    if (clusters.clusters?.length !== 1) {
        return; // TODO error
    }

    if (stacks.Stacks?.length !== 1) {
        return; // TODO: error
    }

    const stack = stacks.Stacks[0];
    const cluster = clusters.clusters[0];

    const parameters = stack.Parameters?.reduce<Record<string, string | undefined>>((map, parameter) => {
        const key = parameter.ParameterKey;

        if (key) {
            map[key] = parameter.ParameterValue;
        }

        return map;
    }, {})

    return {
        statusCode: 200,
        body: JSON.stringify({
            serverState: parameters?.ServerState,
            stackStatus: stack.StackStatus,
            clusterRunningTasks: cluster.runningTasksCount,
            registeredContainerInstancesCount: cluster.registeredContainerInstancesCount,
            players: query?.players?.length ?? null,
            cluster: cluster,
            stack: stack,
        }),
    };
};
