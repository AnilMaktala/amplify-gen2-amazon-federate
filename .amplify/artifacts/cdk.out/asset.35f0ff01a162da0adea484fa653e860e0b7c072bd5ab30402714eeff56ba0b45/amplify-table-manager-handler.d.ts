import { ContinuousBackupsDescription, CreateTableCommandInput, TableDescription, TimeToLiveDescription, UpdateContinuousBackupsCommandInput, UpdateTableCommandInput, UpdateTimeToLiveCommandInput } from '@aws-sdk/client-dynamodb';
export declare const onEvent: (event: AWSCDKAsyncCustomResource.OnEventRequest) => Promise<AWSCDKAsyncCustomResource.OnEventResponse>;
export declare const isComplete: (event: AWSCDKAsyncCustomResource.IsCompleteRequest) => Promise<AWSCDKAsyncCustomResource.IsCompleteResponse>;
export declare const getNextAtomicUpdate: (currentState: TableDescription, endState: CustomDDB.Input) => UpdateTableCommandInput | undefined;
export declare const getStreamUpdate: (currentState: TableDescription, endState: CustomDDB.Input) => Promise<UpdateTableCommandInput | undefined>;
export declare const getSseUpdate: (currentState: TableDescription, endState: CustomDDB.Input) => UpdateTableCommandInput | undefined;
export declare const getDeletionProtectionUpdate: (currentState: TableDescription, endState: CustomDDB.Input) => UpdateTableCommandInput | undefined;
export declare const getTtlUpdate: (currentTTL: TimeToLiveDescription | undefined, endState: CustomDDB.Input) => UpdateTimeToLiveCommandInput | undefined;
export declare const getPointInTimeRecoveryUpdate: (currentPointInTime: ContinuousBackupsDescription | undefined, endState: CustomDDB.Input) => UpdateContinuousBackupsCommandInput | undefined;
export declare const extractTableInputFromEvent: (event: AWSCDKAsyncCustomResource.OnEventRequest | AWSCDKAsyncCustomResource.IsCompleteRequest) => CustomDDB.Input;
export declare const toCreateTableInput: (props: CustomDDB.Input) => CreateTableCommandInput;
//# sourceMappingURL=amplify-table-manager-handler.d.ts.map