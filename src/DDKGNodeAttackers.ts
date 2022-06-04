import { DDKGNode, DDKGNodeConfig } from "./DDKGNode";
import { DKGNodeAttackerWrongShare } from "./DKGNodeAttackers";

export class DDKGNodeAttackerWrongShare extends DDKGNode {
    constructor(config: DDKGNodeConfig) {
        super(config);
        this.dkg = new DKGNodeAttackerWrongShare(config.n, config.t, config.selfNode.index);
    }
}
