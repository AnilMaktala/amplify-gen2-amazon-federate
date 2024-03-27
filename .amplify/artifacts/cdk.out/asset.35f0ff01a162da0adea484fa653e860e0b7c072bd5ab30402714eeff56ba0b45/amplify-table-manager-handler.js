"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCreateTableInput = exports.extractTableInputFromEvent = exports.getPointInTimeRecoveryUpdate = exports.getTtlUpdate = exports.getDeletionProtectionUpdate = exports.getSseUpdate = exports.getStreamUpdate = exports.getNextAtomicUpdate = exports.isComplete = exports.onEvent = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const ddbClient = new client_dynamodb_1.DynamoDB();
const finished = {
    IsComplete: true,
};
const notFinished = {
    IsComplete: false,
};
const log = (msg, ...other) => {
    console.log(msg, other.map((o) => (typeof o === 'object' ? JSON.stringify(o, undefined, 2) : o)));
};
const onEvent = async (event) => {
    var _a;
    console.log({ ...event, ResponseURL: '[redacted]' });
    const tableDef = (0, exports.extractTableInputFromEvent)(event);
    console.log('Input table state: ', tableDef);
    let result;
    switch (event.RequestType) {
        case 'Create':
            console.log('Initiating CREATE event');
            const createTableInput = (0, exports.toCreateTableInput)(tableDef);
            console.log('Create Table Params: ', createTableInput);
            const response = await createNewTable(createTableInput);
            result = {
                PhysicalResourceId: response.tableName,
                Data: {
                    TableArn: response.tableArn,
                    TableStreamArn: response.streamArn,
                    TableName: response.tableName,
                },
            };
            console.log('Returning result: ', result);
            return result;
        case 'Update':
            if (!event.PhysicalResourceId) {
                throw new Error(`Could not find the physical ID for the updated resource`);
            }
            console.log('Fetching current table state');
            const describeTableResult = await ddbClient.describeTable({ TableName: event.PhysicalResourceId });
            if (!describeTableResult.Table) {
                throw new Error(`Could not find ${event.PhysicalResourceId} to update`);
            }
            log('Current table state: ', describeTableResult);
            if (isKeySchemaModified(describeTableResult.Table.KeySchema, tableDef.keySchema)) {
                console.log('Detected table key schema change. Update requires replacement');
                if (tableDef.allowDestructiveGraphqlSchemaUpdates) {
                    return replaceTable(describeTableResult.Table, tableDef);
                }
                else {
                    throw new Error("Editing key schema of table requires replacement which will cause ALL EXISITING DATA TO BE LOST. If this is intended, set the 'allowDestructiveGraphqlSchemaUpdates' to true and deploy again.");
                }
            }
            if (tableDef.replaceTableUponGsiUpdate && tableDef.allowDestructiveGraphqlSchemaUpdates) {
                const nextUpdate = getNextGSIUpdate(describeTableResult.Table, tableDef);
                if (nextUpdate !== undefined) {
                    console.log('Detected global secondary index changes in sandbox mode with destructive updates allowed. Update requires replacement');
                    return replaceTable(describeTableResult.Table, tableDef);
                }
            }
            const describePointInTimeRecoveryResult = await ddbClient.describeContinuousBackups({ TableName: event.PhysicalResourceId });
            console.log('Current point in time recovery: ', describePointInTimeRecoveryResult);
            const pointInTimeUpdate = (0, exports.getPointInTimeRecoveryUpdate)(describePointInTimeRecoveryResult.ContinuousBackupsDescription, tableDef);
            if (pointInTimeUpdate) {
                log('Computed point in time recovery update', pointInTimeUpdate);
                await ddbClient.updateContinuousBackups(pointInTimeUpdate);
                await retry(async () => await isTableReady(event.PhysicalResourceId), (res) => res === true);
                console.log(`Table '${event.PhysicalResourceId}' is ready after the update of PointInTimeRecovery.`);
            }
            const deletionProtectionUpdate = (0, exports.getDeletionProtectionUpdate)(describeTableResult.Table, tableDef);
            if (deletionProtectionUpdate) {
                log('Computed deletion protection update', deletionProtectionUpdate);
                await ddbClient.updateTable(deletionProtectionUpdate);
                await retry(async () => await isTableReady(event.PhysicalResourceId), (res) => res === true);
                console.log(`Table '${event.PhysicalResourceId}' is ready after the update of deletion protection.`);
            }
            const sseUpdate = (0, exports.getSseUpdate)(describeTableResult.Table, tableDef);
            if (sseUpdate) {
                log('Computed server side encryption update', sseUpdate);
                await ddbClient.updateTable(sseUpdate);
                await retry(async () => await isTableReady(event.PhysicalResourceId), (res) => res === true);
                console.log(`Table '${event.PhysicalResourceId}' is ready after the update of sever side encryption.`);
            }
            const streamUpdate = await (0, exports.getStreamUpdate)(describeTableResult.Table, tableDef);
            if (streamUpdate) {
                log('Computed stream specification update', streamUpdate);
                await ddbClient.updateTable(streamUpdate);
                await retry(async () => await isTableReady(event.PhysicalResourceId), (res) => res === true);
                console.log(`Table '${event.PhysicalResourceId}' is ready after the update of stream specificaion.`);
            }
            const describeTimeToLiveResult = await ddbClient.describeTimeToLive({ TableName: event.PhysicalResourceId });
            console.log('Current TTL: ', describeTimeToLiveResult);
            const ttlUpdate = (0, exports.getTtlUpdate)(describeTimeToLiveResult.TimeToLiveDescription, tableDef);
            if (ttlUpdate) {
                log('Computed time to live update', ttlUpdate);
                console.log('Initiating TTL update');
                await ddbClient.updateTimeToLive(ttlUpdate);
                result = {
                    PhysicalResourceId: event.PhysicalResourceId,
                    Data: {
                        TableArn: describeTableResult.Table.TableArn,
                        TableStreamArn: describeTableResult.Table.LatestStreamArn,
                        TableName: describeTableResult.Table.TableName,
                    },
                };
                return result;
            }
            const nextGsiUpdate = (0, exports.getNextAtomicUpdate)(describeTableResult.Table, tableDef);
            if (nextGsiUpdate) {
                log('Computed next update', nextGsiUpdate);
                console.log('Initiating table GSI update');
                await ddbClient.updateTable(nextGsiUpdate);
            }
            result = {
                PhysicalResourceId: event.PhysicalResourceId,
                Data: {
                    TableArn: describeTableResult.Table.TableArn,
                    TableStreamArn: describeTableResult.Table.LatestStreamArn,
                    TableName: describeTableResult.Table.TableName,
                },
            };
            return result;
        case 'Delete':
            if (!event.PhysicalResourceId) {
                throw new Error(`Could not find the physical ID for the resource`);
            }
            result = {
                PhysicalResourceId: event.PhysicalResourceId,
            };
            try {
                console.log('Fetching current table state');
                const describeTableResultBeforeDeletion = await ddbClient.describeTable({ TableName: event.PhysicalResourceId });
                if ((_a = describeTableResultBeforeDeletion.Table) === null || _a === void 0 ? void 0 : _a.DeletionProtectionEnabled) {
                    return result;
                }
                console.log('Initiating table deletion');
                await ddbClient.deleteTable({ TableName: event.PhysicalResourceId });
                return result;
            }
            catch (err) {
                if (err instanceof client_dynamodb_1.ResourceNotFoundException) {
                    console.log('Table to be deleted is not found. Deletion complete.');
                    return result;
                }
                throw err;
            }
        default:
            throw new Error(`Event type ${event.RequestType} is not supported`);
    }
};
exports.onEvent = onEvent;
const isComplete = async (event) => {
    var _a, _b, _c;
    log('got event', { ...event, ResponseURL: '[redacted]' });
    if (event.RequestType === 'Delete') {
        console.log('Delete is finished');
        return finished;
    }
    if (!event.PhysicalResourceId) {
        throw new Error('PhysicalResourceId not set in call to isComplete');
    }
    console.log('Fetching current table state');
    const describeTableResult = await retry(async () => await ddbClient.describeTable({ TableName: event.PhysicalResourceId }), (result) => !!(result === null || result === void 0 ? void 0 : result.Table));
    if (((_a = describeTableResult.Table) === null || _a === void 0 ? void 0 : _a.TableStatus) !== 'ACTIVE') {
        console.log('Table not active yet');
        return notFinished;
    }
    if ((_b = describeTableResult.Table.GlobalSecondaryIndexes) === null || _b === void 0 ? void 0 : _b.some((gsi) => gsi.IndexStatus !== 'ACTIVE' || gsi.Backfilling)) {
        console.log('Some GSI is not active yet');
        return notFinished;
    }
    const endState = (0, exports.extractTableInputFromEvent)(event);
    if (event.RequestType === 'Create' || ((_c = event.Data) === null || _c === void 0 ? void 0 : _c.IsTableReplaced) === true) {
        const describePointInTimeRecoveryResult = await ddbClient.describeContinuousBackups({ TableName: event.PhysicalResourceId });
        const pointInTimeUpdate = (0, exports.getPointInTimeRecoveryUpdate)(describePointInTimeRecoveryResult.ContinuousBackupsDescription, endState);
        if (pointInTimeUpdate) {
            console.log('Updating table with point in time recovery enabled');
            await ddbClient.updateContinuousBackups(pointInTimeUpdate);
            return notFinished;
        }
        const describeTimeToLiveResult = await ddbClient.describeTimeToLive({ TableName: event.PhysicalResourceId });
        const ttlUpdate = (0, exports.getTtlUpdate)(describeTimeToLiveResult.TimeToLiveDescription, endState);
        if (ttlUpdate) {
            console.log('Updating table with TTL enabled');
            await ddbClient.updateTimeToLive(ttlUpdate);
            return notFinished;
        }
        console.log('Create is finished');
        return finished;
    }
    const nextUpdate = (0, exports.getNextAtomicUpdate)(describeTableResult.Table, endState);
    log('Computed next update', nextUpdate);
    if (!nextUpdate) {
        console.log('No additional updates needed. Update finished');
        return finished;
    }
    console.log('Initiating table update');
    await ddbClient.updateTable(nextUpdate);
    return notFinished;
};
exports.isComplete = isComplete;
const replaceTable = async (currentState, endState) => {
    if (currentState.DeletionProtectionEnabled === true) {
        throw new Error('Table cannot be replaced when the deletion protection is enabled.');
    }
    console.log('Deleting the old table');
    await ddbClient.deleteTable({ TableName: currentState.TableName });
    await retry(async () => await doesTableExist(currentState.TableName), (res) => res === false);
    console.log(`Table '${currentState.TableName}' does not exist. Deletion is finished.`);
    const createTableInput = (0, exports.toCreateTableInput)(endState);
    console.log('Creating the new table');
    const response = await createNewTable(createTableInput);
    const result = {
        PhysicalResourceId: response.tableName,
        Data: {
            TableArn: response.tableArn,
            TableStreamArn: response.streamArn,
            TableName: response.tableName,
            IsTableReplaced: true,
        },
    };
    log('Returning result', result);
    return result;
};
const getNextAtomicUpdate = (currentState, endState) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const currentStateGSIs = currentState.GlobalSecondaryIndexes || [];
    const isTableBillingModeModified = (((_a = currentState.BillingModeSummary) === null || _a === void 0 ? void 0 : _a.BillingMode) !== undefined && ((_b = currentState.BillingModeSummary) === null || _b === void 0 ? void 0 : _b.BillingMode) !== endState.billingMode) ||
        (((_c = currentState.BillingModeSummary) === null || _c === void 0 ? void 0 : _c.BillingMode) == undefined && endState.billingMode === 'PAY_PER_REQUEST');
    const isTableProvisionThroughputModified = (((_d = endState.provisionedThroughput) === null || _d === void 0 ? void 0 : _d.readCapacityUnits) !== undefined &&
        ((_e = currentState.ProvisionedThroughput) === null || _e === void 0 ? void 0 : _e.ReadCapacityUnits) !== ((_f = endState.provisionedThroughput) === null || _f === void 0 ? void 0 : _f.readCapacityUnits)) ||
        (((_g = endState.provisionedThroughput) === null || _g === void 0 ? void 0 : _g.writeCapacityUnits) !== undefined &&
            ((_h = currentState.ProvisionedThroughput) === null || _h === void 0 ? void 0 : _h.WriteCapacityUnits) !== ((_j = endState.provisionedThroughput) === null || _j === void 0 ? void 0 : _j.writeCapacityUnits));
    if (isTableBillingModeModified || isTableProvisionThroughputModified) {
        let updateInput = {
            TableName: currentState.TableName,
            BillingMode: isTableBillingModeModified ? endState.billingMode : undefined,
            ProvisionedThroughput: isTableProvisionThroughputModified && endState.billingMode === 'PROVISIONED'
                ? {
                    ReadCapacityUnits: (_k = endState.provisionedThroughput) === null || _k === void 0 ? void 0 : _k.readCapacityUnits,
                    WriteCapacityUnits: (_l = endState.provisionedThroughput) === null || _l === void 0 ? void 0 : _l.writeCapacityUnits,
                }
                : undefined,
        };
        if (isTableBillingModeModified && endState.billingMode === 'PROVISIONED') {
            const indexToBeUpdated = currentStateGSIs.map((gsiToUpdate) => {
                var _a, _b;
                return {
                    Update: {
                        IndexName: gsiToUpdate.IndexName,
                        ProvisionedThroughput: {
                            ReadCapacityUnits: (_a = endState.provisionedThroughput) === null || _a === void 0 ? void 0 : _a.readCapacityUnits,
                            WriteCapacityUnits: (_b = endState.provisionedThroughput) === null || _b === void 0 ? void 0 : _b.writeCapacityUnits,
                        },
                    },
                };
            });
            updateInput = {
                ...updateInput,
                GlobalSecondaryIndexUpdates: indexToBeUpdated.length > 0 ? indexToBeUpdated : undefined,
            };
        }
        return parsePropertiesToDynamoDBInput(updateInput);
    }
    return getNextGSIUpdate(currentState, endState);
};
exports.getNextAtomicUpdate = getNextAtomicUpdate;
const getNextGSIUpdate = (currentState, endState) => {
    var _a, _b, _c, _d, _e;
    const endStateGSIs = endState.globalSecondaryIndexes || [];
    const endStateGSINames = endStateGSIs.map((gsi) => gsi.indexName);
    const currentStateGSIs = currentState.GlobalSecondaryIndexes || [];
    const currentStateGSINames = currentStateGSIs.map((gsi) => gsi.IndexName);
    const gsiRequiresReplacementPredicate = (currentGSI) => {
        if (!endStateGSINames.includes(currentGSI.IndexName))
            return true;
        const respectiveEndStateGSI = endStateGSIs.find((endStateGSI) => endStateGSI.indexName === currentGSI.IndexName);
        if (isProjectionModified(currentGSI.Projection, respectiveEndStateGSI.projection))
            return true;
        if (isKeySchemaModified(currentGSI.KeySchema, respectiveEndStateGSI.keySchema))
            return true;
        return false;
    };
    const gsiToRemove = currentStateGSIs.find(gsiRequiresReplacementPredicate);
    if (gsiToRemove) {
        return {
            TableName: currentState.TableName,
            GlobalSecondaryIndexUpdates: [
                {
                    Delete: {
                        IndexName: gsiToRemove.IndexName,
                    },
                },
            ],
        };
    }
    const gsiRequiresCreationPredicate = (endStateGSI) => !currentStateGSINames.includes(endStateGSI.indexName);
    const gsiToAdd = endStateGSIs.find(gsiRequiresCreationPredicate);
    if (gsiToAdd) {
        let gsiProvisionThroughput = gsiToAdd.provisionedThroughput;
        if (endState.billingMode === 'PROVISIONED' && gsiToAdd.provisionedThroughput === undefined) {
            gsiProvisionThroughput = {
                readCapacityUnits: (_a = endState.provisionedThroughput) === null || _a === void 0 ? void 0 : _a.readCapacityUnits,
                writeCapacityUnits: (_b = endState.provisionedThroughput) === null || _b === void 0 ? void 0 : _b.writeCapacityUnits,
            };
        }
        const attributeNamesToInclude = gsiToAdd.keySchema.map((schema) => schema.attributeName);
        const gsiToAddAction = {
            IndexName: gsiToAdd.indexName,
            KeySchema: gsiToAdd.keySchema,
            Projection: gsiToAdd.projection,
            ProvisionedThroughput: gsiProvisionThroughput,
        };
        return {
            TableName: currentState.TableName,
            AttributeDefinitions: (_c = endState.attributeDefinitions) === null || _c === void 0 ? void 0 : _c.filter((def) => attributeNamesToInclude.includes(def.attributeName)).map((def) => usePascalCaseForObjectKeys(def)),
            GlobalSecondaryIndexUpdates: [
                {
                    Create: parsePropertiesToDynamoDBInput(gsiToAddAction),
                },
            ],
        };
    }
    const gsiRequiresUpdatePredicate = (endStateGSI) => {
        var _a, _b, _c, _d;
        if (endState.provisionedThroughput &&
            endState.provisionedThroughput.readCapacityUnits &&
            endState.provisionedThroughput.writeCapacityUnits &&
            currentStateGSINames.includes(endStateGSI.indexName)) {
            const currentStateGSI = currentStateGSIs.find((gsi) => gsi.IndexName === endStateGSI.indexName);
            if (currentStateGSI) {
                if (((_a = currentStateGSI.ProvisionedThroughput) === null || _a === void 0 ? void 0 : _a.ReadCapacityUnits) !== ((_b = endStateGSI.provisionedThroughput) === null || _b === void 0 ? void 0 : _b.readCapacityUnits) ||
                    ((_c = currentStateGSI.ProvisionedThroughput) === null || _c === void 0 ? void 0 : _c.WriteCapacityUnits) !== ((_d = endStateGSI.provisionedThroughput) === null || _d === void 0 ? void 0 : _d.writeCapacityUnits)) {
                    return true;
                }
            }
        }
        return false;
    };
    const gsiToUpdate = endStateGSIs.find(gsiRequiresUpdatePredicate);
    if (gsiToUpdate) {
        return {
            TableName: currentState.TableName,
            GlobalSecondaryIndexUpdates: [
                {
                    Update: {
                        IndexName: gsiToUpdate.indexName,
                        ProvisionedThroughput: {
                            ReadCapacityUnits: (_d = gsiToUpdate.provisionedThroughput) === null || _d === void 0 ? void 0 : _d.readCapacityUnits,
                            WriteCapacityUnits: (_e = gsiToUpdate.provisionedThroughput) === null || _e === void 0 ? void 0 : _e.writeCapacityUnits,
                        },
                    },
                },
            ],
        };
    }
    return undefined;
};
const getStreamUpdate = async (currentState, endState) => {
    var _a, _b, _c, _d, _e, _f;
    let streamUpdate;
    if (((_a = endState.streamSpecification) === null || _a === void 0 ? void 0 : _a.streamViewType) !== undefined &&
        (currentState.StreamSpecification === undefined || currentState.StreamSpecification.StreamEnabled === false)) {
        streamUpdate = { StreamEnabled: true, StreamViewType: endState.streamSpecification.streamViewType };
    }
    else if (((_b = endState.streamSpecification) === null || _b === void 0 ? void 0 : _b.streamViewType) === undefined && ((_c = currentState.StreamSpecification) === null || _c === void 0 ? void 0 : _c.StreamEnabled) === true) {
        streamUpdate = { StreamEnabled: false };
    }
    else if (((_d = currentState.StreamSpecification) === null || _d === void 0 ? void 0 : _d.StreamEnabled) === true &&
        ((_e = endState.streamSpecification) === null || _e === void 0 ? void 0 : _e.streamViewType) !== undefined &&
        currentState.StreamSpecification.StreamViewType !== ((_f = endState.streamSpecification) === null || _f === void 0 ? void 0 : _f.streamViewType)) {
        console.log('Detect stream view type is changed. Disabling stream before the type change.');
        await ddbClient.updateTable({
            TableName: currentState.TableName,
            StreamSpecification: { StreamEnabled: false },
        });
        await retry(async () => await isTableReady(currentState.TableName), (res) => res === true);
        streamUpdate = { StreamEnabled: true, StreamViewType: endState.streamSpecification.streamViewType };
    }
    if (streamUpdate) {
        return {
            TableName: currentState.TableName,
            StreamSpecification: streamUpdate,
        };
    }
    return undefined;
};
exports.getStreamUpdate = getStreamUpdate;
const getSseUpdate = (currentState, endState) => {
    var _a, _b, _c;
    let sseUpdate;
    if (currentState.SSEDescription) {
        if (!((_a = endState.sseSpecification) === null || _a === void 0 ? void 0 : _a.sseEnabled)) {
            sseUpdate = {
                Enabled: false,
            };
        }
        else if (((_b = endState.sseSpecification) === null || _b === void 0 ? void 0 : _b.sseEnabled) === true &&
            endState.sseSpecification.sseType !== undefined &&
            endState.sseSpecification.sseType !== currentState.SSEDescription.SSEType) {
            sseUpdate = {
                Enabled: true,
                SSEType: endState.sseSpecification.sseType,
                KMSMasterKeyId: endState.sseSpecification.kmsMasterKeyId,
            };
        }
    }
    else {
        if ((_c = endState.sseSpecification) === null || _c === void 0 ? void 0 : _c.sseEnabled) {
            sseUpdate = {
                Enabled: true,
                SSEType: endState.sseSpecification.sseType,
                KMSMasterKeyId: endState.sseSpecification.kmsMasterKeyId,
            };
        }
    }
    if (sseUpdate) {
        return parsePropertiesToDynamoDBInput({
            TableName: currentState.TableName,
            SSESpecification: sseUpdate,
        });
    }
    return undefined;
};
exports.getSseUpdate = getSseUpdate;
const getDeletionProtectionUpdate = (currentState, endState) => {
    if (endState.deletionProtectionEnabled !== undefined && currentState.DeletionProtectionEnabled !== endState.deletionProtectionEnabled) {
        return {
            TableName: currentState.TableName,
            DeletionProtectionEnabled: endState.deletionProtectionEnabled,
        };
    }
    else if (endState.deletionProtectionEnabled === undefined && currentState.DeletionProtectionEnabled === true) {
        return {
            TableName: currentState.TableName,
            DeletionProtectionEnabled: false,
        };
    }
    return undefined;
};
exports.getDeletionProtectionUpdate = getDeletionProtectionUpdate;
const getTtlUpdate = (currentTTL, endState) => {
    const endTTL = endState.timeToLiveSpecification;
    if (currentTTL && currentTTL.TimeToLiveStatus) {
        if (currentTTL.TimeToLiveStatus === 'ENABLED' && currentTTL.AttributeName) {
            if (!endTTL || !endTTL.enabled) {
                return {
                    TableName: endState.tableName,
                    TimeToLiveSpecification: {
                        Enabled: false,
                        AttributeName: currentTTL.AttributeName,
                    },
                };
            }
            else if (currentTTL.AttributeName !== endTTL.attributeName) {
                return {
                    TableName: endState.tableName,
                    TimeToLiveSpecification: {
                        Enabled: true,
                        AttributeName: endTTL.attributeName,
                    },
                };
            }
        }
        else if (currentTTL.TimeToLiveStatus === 'DISABLED' && endTTL && endTTL.enabled) {
            return {
                TableName: endState.tableName,
                TimeToLiveSpecification: {
                    Enabled: true,
                    AttributeName: endTTL.attributeName,
                },
            };
        }
    }
    return undefined;
};
exports.getTtlUpdate = getTtlUpdate;
const getPointInTimeRecoveryUpdate = (currentPointInTime, endState) => {
    var _a, _b;
    if (!currentPointInTime) {
        return undefined;
    }
    const currentStatus = (_a = currentPointInTime.PointInTimeRecoveryDescription) === null || _a === void 0 ? void 0 : _a.PointInTimeRecoveryStatus;
    const endStatus = (_b = endState.pointInTimeRecoverySpecification) === null || _b === void 0 ? void 0 : _b.pointInTimeRecoveryEnabled;
    if (endStatus === undefined || endStatus === false) {
        if (currentStatus === 'ENABLED') {
            return {
                TableName: endState.tableName,
                PointInTimeRecoverySpecification: {
                    PointInTimeRecoveryEnabled: false,
                },
            };
        }
    }
    else {
        if (currentStatus === 'DISABLED') {
            return {
                TableName: endState.tableName,
                PointInTimeRecoverySpecification: {
                    PointInTimeRecoveryEnabled: true,
                },
            };
        }
    }
    return undefined;
};
exports.getPointInTimeRecoveryUpdate = getPointInTimeRecoveryUpdate;
const extractTableInputFromEvent = (event) => {
    const resourceProperties = { ...event.ResourceProperties };
    delete resourceProperties.ServiceToken;
    const tableDef = convertStringToBooleanOrNumber(resourceProperties);
    return tableDef;
};
exports.extractTableInputFromEvent = extractTableInputFromEvent;
const parsePropertiesToDynamoDBInput = (obj) => {
    return usePascalCaseForObjectKeys(removeUndefinedAttributes(obj));
};
const usePascalCaseForObjectKeys = (obj) => {
    const result = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key) && key !== '') {
            const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
            const value = obj[key];
            if (Array.isArray(value)) {
                result[capitalizedKey] = value.map((v) => usePascalCaseForObjectKeys(v));
            }
            else if (typeof value === 'object' && value !== null) {
                result[capitalizedKey] = usePascalCaseForObjectKeys(value);
            }
            else {
                result[capitalizedKey] = value;
            }
        }
    }
    return result;
};
const convertStringToBooleanOrNumber = (obj) => {
    const fieldsToBeConvertedToBoolean = [
        'deletionProtectionEnabled',
        'enabled',
        'sseEnabled',
        'pointInTimeRecoveryEnabled',
        'allowDestructiveGraphqlSchemaUpdates',
        'replaceTableUponGsiUpdate',
    ];
    const fieldsToBeConvertedToNumber = ['readCapacityUnits', 'writeCapacityUnits'];
    for (const key in obj) {
        if (Array.isArray(obj[key])) {
            obj[key] = obj[key].map((o) => convertStringToBooleanOrNumber(o));
        }
        else if (typeof obj[key] === 'object') {
            obj[key] = convertStringToBooleanOrNumber(obj[key]);
        }
        else if (typeof obj[key] === 'string') {
            if ((obj[key] === 'true' || obj[key] === 'false') && fieldsToBeConvertedToBoolean.includes(key)) {
                obj[key] = obj[key] === 'true';
            }
            else if (!isNaN(Number(obj[key])) && fieldsToBeConvertedToNumber.includes(key)) {
                obj[key] = Number(obj[key]);
            }
        }
    }
    return obj;
};
const removeUndefinedAttributes = (obj) => {
    for (const key in obj) {
        if (Array.isArray(obj[key])) {
            obj[key].map((o) => removeUndefinedAttributes(o));
        }
        else if (typeof obj[key] === 'object') {
            removeUndefinedAttributes(obj[key]);
        }
        else if (obj[key] === undefined) {
            delete obj[key];
        }
    }
    return obj;
};
const toCreateTableInput = (props) => {
    const createTableInput = {
        TableName: props.tableName,
        AttributeDefinitions: props.attributeDefinitions,
        KeySchema: props.keySchema,
        GlobalSecondaryIndexes: props.globalSecondaryIndexes,
        BillingMode: props.billingMode,
        StreamSpecification: props.streamSpecification
            ? {
                StreamEnabled: true,
                StreamViewType: props.streamSpecification.streamViewType,
            }
            : undefined,
        ProvisionedThroughput: props.provisionedThroughput,
        SSESpecification: props.sseSpecification ? { Enabled: props.sseSpecification.sseEnabled } : undefined,
        DeletionProtectionEnabled: props.deletionProtectionEnabled,
    };
    return parsePropertiesToDynamoDBInput(createTableInput);
};
exports.toCreateTableInput = toCreateTableInput;
const createNewTable = async (input) => {
    var _a;
    const tableName = input.TableName;
    const createTableInput = input;
    const result = await ddbClient.createTable(createTableInput);
    return { tableName: tableName, tableArn: result.TableDescription.TableArn, streamArn: (_a = result.TableDescription) === null || _a === void 0 ? void 0 : _a.LatestStreamArn };
};
const doesTableExist = async (tableName) => {
    try {
        await ddbClient.describeTable({ TableName: tableName });
        return true;
    }
    catch (error) {
        if (error instanceof client_dynamodb_1.ResourceNotFoundException) {
            return false;
        }
        throw error;
    }
};
const isTableReady = async (tableName) => {
    var _a, _b;
    const result = await ddbClient.describeTable({ TableName: tableName });
    if (((_a = result.Table) === null || _a === void 0 ? void 0 : _a.TableStatus) !== 'ACTIVE') {
        console.log('Table not active yet');
        return false;
    }
    if ((_b = result.Table.GlobalSecondaryIndexes) === null || _b === void 0 ? void 0 : _b.some((gsi) => gsi.IndexStatus !== 'ACTIVE' || gsi.Backfilling)) {
        console.log('Some GSI is not active yet');
        return false;
    }
    return true;
};
const isProjectionModified = (currentProjection, endProjection) => {
    if (currentProjection.ProjectionType !== endProjection.projectionType)
        return true;
    if (currentProjection.ProjectionType === 'ALL')
        return false;
    const currentNonKeyAttributes = currentProjection.NonKeyAttributes || [];
    const endNonKeyAttributes = endProjection.nonKeyAttributes || [];
    if (currentNonKeyAttributes.length !== endNonKeyAttributes.length)
        return true;
    if (currentNonKeyAttributes.some((currentNonKeyAttribute) => !endNonKeyAttributes.includes(currentNonKeyAttribute)))
        return true;
    return false;
};
const isKeySchemaModified = (currentSchema, endSchema) => {
    const currentHashKey = currentSchema.find((schema) => schema.KeyType === 'HASH');
    const endHashKey = endSchema.find((schema) => schema.keyType === 'HASH');
    if ((currentHashKey === null || currentHashKey === void 0 ? void 0 : currentHashKey.AttributeName) !== (endHashKey === null || endHashKey === void 0 ? void 0 : endHashKey.attributeName))
        return true;
    const currentSortKey = currentSchema.find((schema) => schema.KeyType === 'RANGE');
    const endSortKey = endSchema.find((schema) => schema.keyType === 'RANGE');
    if (currentSortKey === undefined && endSortKey === undefined)
        return false;
    if ((currentSortKey === undefined && endSortKey !== undefined) || (currentSortKey !== undefined && endSortKey === undefined))
        return true;
    if ((currentSortKey === null || currentSortKey === void 0 ? void 0 : currentSortKey.AttributeName) !== (endSortKey === null || endSortKey === void 0 ? void 0 : endSortKey.attributeName))
        return true;
    return false;
};
const defaultSettings = {
    times: Infinity,
    delayMS: 1000 * 15,
    timeoutMS: 1000 * 60 * 14,
    stopOnError: false,
};
const retry = async (func, successPredicate, settings, failurePredicate) => {
    const { times, delayMS, timeoutMS, stopOnError } = {
        ...defaultSettings,
        ...settings,
    };
    let count = 0;
    let result;
    let terminate = false;
    const startTime = Date.now();
    do {
        try {
            result = await func();
            if (successPredicate(result)) {
                return result;
            }
            if (typeof failurePredicate === 'function' && failurePredicate(result)) {
                throw new Error('Retry-able function execution result matched failure predicate. Stopping retries.');
            }
            console.warn(`Retry-able function execution did not match success predicate. Result was [${JSON.stringify(result)}]. Retrying...`);
        }
        catch (err) {
            console.warn(`Retry-able function execution failed with [${err.message || err}]`);
            if (stopOnError) {
                console.log('Stopping retries on error.');
            }
            else {
                console.log('Retrying...');
            }
            terminate = stopOnError;
        }
        count++;
        await sleep(delayMS);
    } while (!terminate && count <= times && Date.now() - startTime < timeoutMS);
    throw new Error('Retry-able function did not match predicate within the given retry constraints');
};
const sleep = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
//# sourceMappingURL=amplify-table-manager-handler.js.map