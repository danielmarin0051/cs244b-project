import * as mcl from "mcl-wasm";
import * as EC from "./elements";
import { lagrangeInterpolationGeneric } from "../algorithms";

// https://en.bitcoin.it/wiki/Secp256k1
// https://github.com/herumi/mcl/blob/3f9cce874188e742eefb9c32435efc6f4d33ecf1/include/mcl/ecparam.hpp#L72
// https://github.com/ethereum/py_ecc/blob/master/py_ecc/secp256k1/secp256k1.py#L29
export const FIELD_MODULUS = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

export const CURVE_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;

const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

export async function initSecp256k1() {
    await mcl.init(mcl.SECP256K1);
}

export class Fp extends EC.Fp {
    get MODULUS(): bigint {
        return FIELD_MODULUS;
    }
    static zero(): Fp {
        return new Fp(0);
    }
    static one(): Fp {
        return new Fp(1);
    }
}

export class Fr extends EC.Fr {
    get MODULUS(): bigint {
        return CURVE_ORDER;
    }
    static zero(): Fr {
        return new Fr(0);
    }
    static one(): Fr {
        return new Fr(1);
    }
}

export class PointG1 extends EC.PointG1 {
    static zero(): PointG1 {
        return new PointG1([Fp.one(), Fp.one(), Fp.zero()]);
    }
    static one(): PointG1 {
        return new PointG1([new Fp(Gx), new Fp(Gy), Fp.one()]);
    }
    getX(): Fp {
        this.normalize();
        return new Fp(this.n.getX());
    }
    getY(): Fp {
        this.normalize();
        return new Fp(this.n.getY());
    }
}

export function lagrangeInterpolation(points: [Fr, Fr][]): (x: Fr) => Fr {
    return lagrangeInterpolationGeneric(points, Fr);
}
