import { Fr, PointG2 } from "./EC/bn128";
import { logger } from "./logger";
import { range, f_i, F_i } from "./utils";

export class DKGNode {
    n: number;
    t: number;
    index: number;

    coeffs: Fr[] = [];
    shares: Fr[] = [];
    commits: PointG2[] = [];

    receivedShares: Record<number, Fr> = {};
    receivedCommits: Record<number, PointG2[]> = {};
    receivedComplaints: Record<number, number[]> = {};
    receivedDisputes: Record<number, Record<number, Fr>> = {};

    QUAL: Set<number> = new Set<number>();
    disqualified: Set<number> = new Set<number>();
    mpk: PointG2 = PointG2.zero();
    mskShare: Fr = Fr.zero();
    QUALPublicKeys: Record<number, PointG2> = [];

    constructor(n: number, t: number, index: number) {
        this.n = n;
        this.t = t;
        this.index = index;
    }

    sharingPhase(): { shares: Fr[]; commits: PointG2[] } {
        const { n, t } = this;
        this.coeffs = range(t + 1).map((_) => new Fr().random());
        this.shares = range(n).map((i) => f_i(new Fr(i + 1), this.coeffs));
        this.commits = this.coeffs.map((coef) => PointG2.one().mul(coef));
        return { shares: this.shares, commits: this.commits };
    }

    verificationPhase(): number[] {
        const { n, index } = this;
        const complaints: number[] = [];
        for (const i of range(n)) {
    if (!this.verifyShare(i, index)) {
                logger.warn(`DKGNode #${index}: Received invalid share from node ${i}`);
                complaints.push(i);
            }
        }
        return complaints;
    }

    disputePhase(): Record<number, Fr> {
        const complainers = new Set<number>();
        for (const j of Object.keys(this.receivedComplaints).map(Number)) {
            if (this.receivedComplaints[j].includes(this.index)) {
                logger.warn(`DKGNode #${this.index}: Node ${j} complained against me.`);
                complainers.add(j);
            }
        }
        const disputes: Record<number, Fr> = {};
        for (const j of complainers) {
            disputes[j] = f_i(new Fr(j + 1), this.coeffs);
        }
        return disputes;
    }

    keyDerivationPhase(): { QUAL: Set<number>; mpk: PointG2; mskShare: Fr } {
        const { QUAL, disqualified } = this.computeQUAL();
        this.QUAL = QUAL;
        this.disqualified = disqualified;
        this.mpk = this.computeMpk();
        this.mskShare = this.computeMskShare();
        this.QUALPublicKeys = this.computeQUALPublicKeys();
        return { QUAL: this.QUAL, mpk: this.mpk, mskShare: this.mskShare };
    }

    private computeQUAL(): { QUAL: Set<number>; disqualified: Set<number> } {
        const disqualified = new Set<number>();
        for (const complainer of Object.keys(this.receivedComplaints).map(Number)) {
            for (const defender of this.receivedComplaints[complainer]) {
                if (disqualified.has(defender)) continue;
                if (this.verifyComplaint(complainer, defender)) {
                    logger.warn(`DKGNode #${this.index}: Complaint from ${complainer} verified against ${defender}`);
                    disqualified.add(defender);
                } else {
                    logger.warn(`DKGNode #${this.index}: Complaint from ${complainer} against ${defender} was solved`);
                    if (complainer === this.index) {
                        logger.warn(`DKGNode #${this.index}: My complaint against ${defender} was solved`);
                        this.receivedShares[defender] = this.receivedDisputes[defender][this.index];
                    }
                }
            }
        }
        const QUAL = new Set<number>([...range(this.n)].filter((x) => !disqualified.has(x)));
        return { QUAL, disqualified };
    }

    private computeMpk(): PointG2 {
        let mpk = PointG2.zero();
        for (const i of this.QUAL) {
            mpk = mpk.add(this.receivedCommits[i][0]);
        }
        return mpk;
    }

    private computeMskShare(): Fr {
        let mskShare = Fr.zero();
        for (const i of this.QUAL) {
            mskShare = mskShare.add(this.receivedShares[i]);
        }
        return mskShare;
    }

    private verifyShare(i: number, j: number): boolean {
        if (this.receivedShares[i] === undefined) return false;
        if (this.receivedCommits[i] === undefined) return false;
        if (this.receivedCommits[i].length !== this.t + 1) return false;
        const left = PointG2.one().mul(this.receivedShares[i]);
        const right = F_i(new Fr(j + 1), this.receivedCommits[i]);
        return left.isEqual(right);
    }

    private verifyComplaint(complainer: number, defender: number) {
        if (this.receivedComplaints[complainer] === undefined) {
            throw new Error("Attempted to verify non existent complaint");
        }
        if (!this.receivedComplaints[complainer].includes(defender)) {
            throw new Error("Attempted to verify non existent complaint");
        }
        if (this.receivedDisputes[defender] === undefined) {
            return true;
        }
        if (this.receivedDisputes[defender][complainer] === undefined) {
            return true;
        }
        if (this.receivedCommits[defender] === undefined) {
            return true;
        }
        const left = PointG2.one().mul(this.receivedDisputes[defender][complainer]);
        const right = F_i(new Fr(complainer + 1), this.receivedCommits[defender]);
        return !left.isEqual(right);
    }

    // TODO: Test me
    private computeQUALPublicKeys() {
        const publicKeys: Record<number, PointG2> = {};
        let QUALPublicPolynomial: PointG2[] = [];
        for (const k of range(this.t + 1)) {
            let sum = PointG2.zero();
            for (const index of this.QUAL) {
                sum = sum.add(this.receivedCommits[index][k]);
            }
            QUALPublicPolynomial.push(sum);
        }
        for (const index of this.QUAL) {
            publicKeys[index] = F_i(new Fr(index + 1), QUALPublicPolynomial);
        }
        return publicKeys;
    }
}

export function executeDKGEndToEnd(nodes: DKGNode[]): void {
    // Step 1: Sharing Phase
    for (const [i, node_i] of nodes.entries()) {
        const { shares, commits } = node_i.sharingPhase();
        for (const [j, node_j] of nodes.entries()) {
            node_j.receivedShares[i] = shares[j];
            node_j.receivedCommits[i] = commits;
        }
    }
    // Step 2: Verification Phase
    for (const [i, node_i] of nodes.entries()) {
        const complaints = node_i.verificationPhase();
        if (complaints.length !== 0) {
            for (const node_j of nodes) {
                node_j.receivedComplaints[i] = complaints;
            }
        }
    }
    // Step 3: Dispute Phase
    for (const [i, node_i] of nodes.entries()) {
        const disputes = node_i.disputePhase();
        if (Object.keys(disputes).length !== 0) {
            for (const node_j of nodes) {
                node_j.receivedDisputes[i] = disputes;
            }
        }
    }
    // Step 4: Key Derivation Phase
    for (const node of nodes) {
        node.keyDerivationPhase();
    }
}
