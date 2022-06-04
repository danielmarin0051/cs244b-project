import * as mcl from "mcl-wasm";
import { modExp } from "../algorithms";

abstract class FieldElement<T extends mcl.Fp | mcl.Fr> {
    n: T;
    type: new () => T;
    constructor(value: number | string | bigint | T | undefined, type: new () => T) {
        this.n = new type();
        this.type = type;
        if (value === undefined) {
            this.n.setInt(0);
        } else if (typeof value === "number") {
            this.n.setInt(value);
        } else if (typeof value === "string") {
            this.n.setStr(value);
        } else if (typeof value === "bigint") {
            this.n.setStr(value.toString());
        } else {
            this.n = value;
        }
    }

    abstract get MODULUS(): bigint;

    inv(): this {
        return new (this.constructor as any)(mcl.inv<T>(this.n));
    }
    neg(): this {
        return new (this.constructor as any)(mcl.neg<T>(this.n));
    }
    isEqual(other: this): boolean {
        return this.n.isEqual(other.n as mcl.Fp & mcl.Fr);
    }
    add(other: this): this {
        return new (this.constructor as any)(mcl.add<T>(this.n, other.n));
    }
    sub(other: this): this {
        return new (this.constructor as any)(mcl.sub<T>(this.n, other.n));
    }
    mul(other: this): this {
        return new (this.constructor as any)(mcl.mul(this.n, other.n));
    }
    pow(other: this): this {
        return new (this.constructor as any)(modExp(this.toBigInt(), other.toBigInt(), this.MODULUS));
    }
    toBigInt(): bigint {
        return BigInt(this.n.getStr());
    }
    toString(): string {
        return this.n.getStr();
    }
    toBytes(bigEndian: boolean = true): Uint8Array {
        if (bigEndian) return this.n.serialize().reverse();
        return this.n.serialize();
    }
    fromBytes(bytes: Uint8Array, bigEndian: boolean = true): this {
        const n = new this.type();
        n.deserialize(bigEndian ? bytes.reverse() : bytes);
        return new (this.constructor as any)(n);
    }
    toLittleEndianHexString(): string {
        return this.n.serializeToHexStr();
    }
    fromLittleEndianHexString(hexString: string): this {
        const n = new this.type();
        n.deserializeHexStr(hexString);
        return new (this.constructor as any)(n);
    }
    random(): this {
        const r = new this.type();
        r.setByCSPRNG();
        return new (this.constructor as any)(r);
    }
}

export abstract class Fp extends FieldElement<mcl.Fp> {
    constructor(value?: number | string | bigint | mcl.Fp) {
        super(value, mcl.Fp);
    }
    static byteSize(): number {
        return 32;
    }
}

export abstract class Fr extends FieldElement<mcl.Fr> {
    constructor(value?: number | string | bigint | mcl.Fr) {
        super(value, mcl.Fr);
    }
    static byteSize(): number {
        return 32;
    }
}

export abstract class Fp2 {
    n: mcl.Fp2;
    constructor(value: [number, number] | [string, string] | [bigint, bigint] | mcl.Fp2) {
        if (value instanceof mcl.Fp2) {
            this.n = value;
        } else if (value instanceof Array) {
            this.n = new mcl.Fp2();
            const [x, y] = value;
            if (typeof x === "number" && typeof y === "number") {
                this.n.setInt(x, y);
            } else {
                const a = new mcl.Fp();
                const b = new mcl.Fp();
                if (typeof x === "string" && typeof y === "string") {
                    a.setStr(x);
                    b.setStr(y);
                } else {
                    a.setStr(x.toString());
                    b.setStr(y.toString());
                }
                this.n.set_a(a);
                this.n.set_b(b);
            }
        } else {
            throw new Error("Invalid arguments");
        }
    }
    inv(): this {
        return new (this.constructor as any)(mcl.inv<mcl.Fp2>(this.n));
    }
    neg(): this {
        return new (this.constructor as any)(mcl.neg<mcl.Fp2>(this.n));
    }
    add(other: this): this {
        return new (this.constructor as any)(mcl.add<mcl.Fp2>(this.n, other.n));
    }
    sub(other: this): this {
        return new (this.constructor as any)(mcl.sub<mcl.Fp2>(this.n, other.n));
    }
    mul(other: this): this {
        return new (this.constructor as any)(mcl.mul(this.n, other.n));
    }
    toString(): string {
        return `[${this.n.get_a().getStr()}, ${this.n.get_b().getStr()}]`;
    }
    toBytes(bigEndian: boolean = true): Uint8Array {
        if (bigEndian) return this.n.serialize().reverse();
        return this.n.serialize();
    }
    fromBytes(bytes: Uint8Array, bigEndian: boolean = true): this {
        const n = new mcl.Fp2();
        n.deserialize(bigEndian ? bytes.reverse() : bytes);
        return new (this.constructor as any)(n);
    }
}

export abstract class PointG1 {
    n: mcl.G1;
    constructor(value?: mcl.G1 | [Fp, Fp, Fp]) {
        if (value === undefined) {
            this.n = new mcl.G1();
        } else if (value instanceof mcl.G1) {
            this.n = value;
        } else {
            this.n = new mcl.G1();
            const [x, y, z] = value;
            this.n.setX(x.n);
            this.n.setY(y.n);
            this.n.setZ(z.n);
        }
    }
    add(other: this): this {
        return new (this.constructor as any)(mcl.add<mcl.G1>(this.n, other.n));
    }
    mul(other: Fr): this {
        return new (this.constructor as any)(mcl.mul(this.n, other.n));
    }
    isEqual(other: this): boolean {
        return this.n.isEqual(other.n);
    }
    normalize(): void {
        this.n.normalize();
    }
    toString(): string {
        return this.n.getStr();
    }
    toBytes(bigEndian: boolean = true): Uint8Array {
        if (bigEndian) return this.n.serialize().reverse();
        return this.n.serialize();
    }
    fromBytes(bytes: Uint8Array, bigEndian: boolean = true): this {
        const n = new mcl.G1();
        n.deserialize(bigEndian ? bytes.reverse() : bytes);
        return new (this.constructor as any)(n);
    }
    toBigInts(): [bigint, bigint] {
        this.n.normalize();
        return [BigInt(this.n.getX().getStr()), BigInt(this.n.getY().getStr())];
    }
    toSerializedHexString(): string {
        return this.n.serializeToHexStr();
    }
    fromSerializedHexString(str: string): this {
        const n = new mcl.G1();
        n.deserializeHexStr(str);
        return new (this.constructor as any)(n);
    }
    serializedByteSize(): number {
        return Fp.byteSize();
    }
}

export abstract class PointG2 {
    n: mcl.G2;
    constructor(value?: mcl.G2 | [Fp2, Fp2, Fp2]) {
        if (value === undefined) {
            this.n = new mcl.G2();
        } else if (value instanceof mcl.G2) {
            this.n = value;
        } else {
            const [x, y, z] = value;
            this.n = new mcl.G2();
            this.n.setX(x.n);
            this.n.setY(y.n);
            this.n.setZ(z.n);
        }
    }
    add(other: this): this {
        return new (this.constructor as any)(mcl.add<mcl.G2>(this.n, other.n));
    }
    mul(other: Fr): this {
        return new (this.constructor as any)(mcl.mul(this.n, other.n));
    }
    isEqual(other: this): boolean {
        return this.n.isEqual(other.n);
    }
    toString(): string {
        return this.n.getStr();
    }
    toBytes(bigEndian: boolean = true): Uint8Array {
        if (bigEndian) return this.n.serialize().reverse();
        return this.n.serialize();
    }
    fromBytes(bytes: Uint8Array, bigEndian: boolean = true): this {
        const n = new mcl.G2();
        n.deserialize(bigEndian ? bytes.reverse() : bytes);
        return new (this.constructor as any)(n);
    }
    normalize(): void {
        this.n.normalize();
    }
    toBigInts(): [bigint, bigint, bigint, bigint] {
        // https://github.com/herumi/mcl-wasm/issues/26#issue-1160940864
        this.n.normalize();

        const xbytes = this.n.getX().serialize();
        const ybytes = this.n.getY().serialize();

        const x = new mcl.Fp2();
        x.deserialize(xbytes);
        const y = new mcl.Fp2();
        y.deserialize(ybytes);

        const x0 = x.get_a().getStr();
        const x1 = x.get_b().getStr();
        const y0 = y.get_a().getStr();
        const y1 = y.get_b().getStr();

        return [BigInt(x0), BigInt(x1), BigInt(y0), BigInt(y1)];
    }
    fromBigInts(ints: [bigint, bigint, bigint, bigint]): this {
        const x = new mcl.Fp2();
        const y = new mcl.Fp2();
        const z = new mcl.Fp2();

        const x0 = new mcl.Fp();
        const x1 = new mcl.Fp();
        const y0 = new mcl.Fp();
        const y1 = new mcl.Fp();
        const z0 = new mcl.Fp();
        const z1 = new mcl.Fp();

        x0.setStr(ints[0].toString());
        x1.setStr(ints[1].toString());
        y0.setStr(ints[2].toString());
        y1.setStr(ints[3].toString());
        z0.setInt(1);
        z1.setInt(0);

        x.set_a(x0);
        x.set_b(x1);
        y.set_a(y0);
        y.set_b(y1);
        z.set_a(z0);
        z.set_b(z1);

        const P = new mcl.G2();
        P.setX(x);
        P.setY(y);
        P.setZ(z);
        return new (this.constructor as any)(P);
    }
    static serializedByteSize(): number {
        return Fp.byteSize() * 2;
    }
}

export function pairing(P1: PointG1, P2: PointG2): mcl.GT {
    return mcl.pairing(P1.n, P2.n);
}
