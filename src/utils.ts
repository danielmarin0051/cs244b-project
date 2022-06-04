import { createHmac } from "crypto";
import { ethers } from "ethers";
import { Fr, PointG1, PointG2 } from "./EC/bn128";

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function range(n: number): number[] {
    return [...Array(n).keys()];
}

export function rangeStart(start: number, end: number): number[] {
    const result: number[] = [];
    for (let i = start; i < end; i++) {
        result.push(i);
    }
    return result;
}

export function f_i(x: Fr, coeffs: Fr[]): Fr {
    let result = Fr.zero();
    for (const [k, coef] of coeffs.entries()) {
        result = result.add(coef.mul(x.pow(new Fr(k))));
    }
    return result;
}

export function F_i(x: Fr, commits: PointG2[]): PointG2 {
    let result = PointG2.zero();
    for (const [k, C_ik] of commits.entries()) {
        result = result.add(C_ik.mul(x.pow(new Fr(k))));
    }
    return result;
}

export function HMAC(sk: Uint8Array, data: string): string {
    const hmac = createHmac("sha256", sk);
    return hmac.update(data).digest("hex");
}

const encoder = new TextEncoder();
export function stringToBytes(str: string): Uint8Array {
    return encoder.encode(str);
}

// export const abiCoder = ethers.utils.defaultAbiCoder;


