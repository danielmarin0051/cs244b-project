import { Aggregator, AggregatorConfig, AggregatorServer, AggregatorServerConfig } from "./Aggregator";
import { HMAC } from "./utils";

export class AggregatorWrongMACAttacker extends Aggregator {
    constructor(config: AggregatorConfig) {
        super(config);
        this.ServerClass = AggregatorWrongMACAttackerServer;
    }
}

class AggregatorWrongMACAttackerServer extends AggregatorServer {
    constructor(config: AggregatorServerConfig) {
        super(config);
    }

    protected getExpectedHMACTag(aggregationId: number): string {
        const sharedDHKey = this.aggregator.aggregationPK.mul(this.aggregationSK).toBytes();
        const data = `wrongdata:${aggregationId}`;
        return HMAC(sharedDHKey, data);
    }
}
