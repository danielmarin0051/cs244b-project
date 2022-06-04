import { Fr, PointG2 } from "./EC/bn128";
import { DKGNode } from "./DKGNode";
import lodash from "lodash";

export class DKGNodeAttackerWrongShare extends DKGNode {
    victimIndex: number;

    constructor(n: number, t: number, index: number) {
        super(n, t, index);
        this.victimIndex = this.chooseRandomVictim();
    }

    sharingPhase(): { shares: Fr[]; commits: PointG2[] } {
        const { shares, commits } = super.sharingPhase();
        shares[this.victimIndex] = new Fr().random();
        return { shares, commits };
    }

    disputePhase(): Record<number, Fr> {
        const disputes = super.disputePhase();
        if (disputes[this.victimIndex] !== undefined) {
            delete disputes[this.victimIndex];
        }
        return disputes;
    }

    private chooseRandomVictim(): number {
        let victim = this.index;
        while (victim === this.index) {
            victim = lodash.random(0, this.n - 1, false);
        }
        return victim;
    }
}
