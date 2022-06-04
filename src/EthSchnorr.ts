import { BigNumber, ethers } from "ethers";
import { arrayify, computeAddress, getAddress, hexlify, keccak256 } from "ethers/lib/utils";
import { CURVE_ORDER, Fp, Fr, PointG1 } from "./EC/secp256k1";

import { ecrecover, pubToAddress, bufferToHex } from "ethereumjs-util";

const Q = CURVE_ORDER;
const HALF_Q = (Q >> 1n) + 1n;

export type EthSchnorrSignature = { sig: Fr; e: Fr; nonceTimesGeneratorAddress: string };

export function KeyGen(): { sk: Fr; pk: PointG1 } {
    let sk: Fr;
    let pk: PointG1;
    do {
        sk = new Fr().random();
        pk = PointG1.one().mul(sk);
    } while (!isValidPK(pk));
    return { sk, pk };
}

export function Sign(sk: Fr, msg: Uint8Array): EthSchnorrSignature {
    const pk = PointG1.one().mul(sk);
    if (!isValidPK(pk)) throw new Error("!isValidPK");
    const k = new Fr().random();
    const nonceTimesGeneratorAddress = computeAddress(k.toBytes());
    const e = ComputeChallenge(pk, msg, nonceTimesGeneratorAddress);
    const sig = k.sub(sk.mul(e));
    return { sig, e, nonceTimesGeneratorAddress };
}

export function Verify(pk: PointG1, msg: Uint8Array, signature: EthSchnorrSignature): boolean {
    const { sig, e } = signature;
    const kG = pk.mul(e).add(PointG1.one().mul(sig));
    const expectedE = ComputeChallenge(pk, msg, PointToEthAddress(kG));
    return expectedE.isEqual(e);
}

export function EthVerify(pk: PointG1, msg: Uint8Array, signature: EthSchnorrSignature): boolean {
    const { sig, nonceTimesGeneratorAddress } = signature;
    const { PKx, PKyp, msgHash } = VerifyHelper(pk, msg);
    if (!isValidPK(pk)) return false;
    if (nonceTimesGeneratorAddress === ethers.constants.AddressZero) return false;
    if (sig.toBigInt() >= Q || sig.isEqual(Fr.zero())) return false;
    if (PKx.isEqual(Fp.zero()) || msgHash.isEqual(Fr.zero())) {
        return false;
    }
    const e = HashMultiple([
        PKx.toBytes(),
        new Uint8Array([PKyp]),
        msgHash.toBytes(),
        arrayify(nonceTimesGeneratorAddress),
    ]);
    const PKxAsFr = new Fr(PKx.toBigInt());
    const digest = BigNumber.from(Q - PKxAsFr.mul(sig).toBigInt()).toHexString();
    const v = PKyp === 0 ? 27 : 28;
    const r = hexlify(PKx.toBytes());
    const s = hexlify(e.mul(PKxAsFr).toBytes());
    const recovered = bufferToHex(
        pubToAddress(ecrecover(Buffer.from(arrayify(digest)), v, Buffer.from(arrayify(r)), Buffer.from(arrayify(s))))
    );
    return nonceTimesGeneratorAddress.toLowerCase() === recovered;
}

export function VerifyHelper(pk: PointG1, msg: Uint8Array) {
    const PKx = pk.getX();
    const PKyp = Number(pk.getY().toBigInt() % 2n);
    const msgHash = Hash(msg);
    return { PKx, PKyp, msgHash };
}

function ComputeChallenge(pk: PointG1, msg: Uint8Array, nonceTimesGeneratorAddress: string) {
    const { PKx, PKyp, msgHash } = VerifyHelper(pk, msg);
    return HashMultiple([
        PKx.toBytes(),
        new Uint8Array([PKyp]),
        msgHash.toBytes(),
        arrayify(nonceTimesGeneratorAddress),
    ]);
}

function HashMultiple(arr: Uint8Array[]): Fr {
    let merged = new Uint8Array();
    for (const x of arr) {
        merged = new Uint8Array([...merged, ...x]);
    }
    return Hash(merged);
}

function Hash(msg: Uint8Array): Fr {
    const hash = keccak256(msg);
    return new Fr(BigInt(hash) % CURVE_ORDER);
}

function isValidPK(pk: PointG1): boolean {
    return pk.getX().toBigInt() < HALF_Q;
}

function PointToEthAddress(p: PointG1): string {
    const px = p.getX().toBytes();
    const py = p.getY().toBytes();
    const hash = arrayify(keccak256(new Uint8Array([...px, ...py])));
    return getAddress(hexlify(hash.slice(32 - 20, 32)));
}
