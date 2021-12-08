import * as AWS from 'aws-sdk';
import * as Gamedig from 'gamedig';

const stackArn = process.env.STACK_ARN as string;
const clusterArn = process.env.CLUSTER_ARN as string;
const roleArn = process.env.ROLE_ARN as string;
const serverHost = process.env.SERVER_HOST as string;
const region = process.env.REGION as string;
const tableName = process.env.TABLE_NAME as string;

const cf = new AWS.CloudFormation({
    region: region,
});

const ecs = new AWS.ECS({
    region: region,
})

const ddb = new AWS.DynamoDB.DocumentClient({
    region: region,
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
        RoleARN: roleArn,
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

module.exports.afk = async () => {
    // request player count
    const query = await Gamedig.query({
        type: 'minecraft',
        host: serverHost,
        socketTimeout: 500,
        attemptTimeout: 10000,
    }).catch(() => null)

    const playerCount = query?.players?.length ?? null

    // if server is offline, give up
    if (playerCount === null) {
        console.log('Server is offline')

        return {statusCode: 200}
    }

    // if >0 delete entry
    if (playerCount > 0) {
        console.log(`Server is populated with ${playerCount} players, ignoring...`)

        await ddb.delete({
            TableName: tableName,
            Key: {
                key: 'offline-since',
            }
        }).promise()

        return {statusCode: 204}
    }

    // if 0, check if entry exists
    const entry = await ddb.get({
        TableName: tableName,
        Key: {
            key: 'offline-since'
        },
    }).promise()

    if (!entry.Item) {
        console.log(`DynamoDB has no entries, registering it`)

        await ddb.put({
            TableName: tableName,
            Item: {
                key: 'offline-since',
                value: (new Date).toISOString(),
            }
        }).promise()

        return {statusCode: 204};
    }

    const offlineSince = entry.Item['value'];
    const offline = new Date(offlineSince);
    const now = new Date;
    const delta = now.getTime() - offline.getTime();

    console.log('Server is offline for', delta / 1000 / 60, 'minutes')

    // if entry exists check if time is done
    if (delta > 15 * 60 * 1000) {
        await updateServerState('Stopped')

        await ddb.delete({
            TableName: tableName,
            Key: {
                key: 'offline-since',
            }
        }).promise()

        return {statusCode: 204}
    }

    return {statusCode: 204};
}
