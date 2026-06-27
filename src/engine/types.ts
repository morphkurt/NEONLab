/** Declare globals injected by the engine script tags */

export interface KeystoneAsmResult {
  failed: boolean;
  mc: Record<number, number> | null;
}

export interface KeystoneHandle {
  asm(src: string, addr: number): KeystoneAsmResult;
  close(): void;
}

export interface KeystoneModule {
  ARCH_ARM: number;
  MODE_ARM: number;
  Keystone: new (arch: number, mode: number) => KeystoneHandle;
}

export interface UnicornHandle {
  reg_write_i32(reg: number, val: number): void;
  reg_read_i32(reg: number): number;
  mem_map(addr: number, size: number, perms: number): void;
  mem_write(addr: number, data: Uint8Array): void;
  mem_read(addr: number, size: number): Uint8Array;
  emu_start(begin: number, until: number, timeout: number, count: number): void;
  close(): void;
}

export interface UnicornModule {
  ARCH_ARM: number;
  MODE_ARM: number;
  PROT_ALL: number;
  ARM_REG_R0: number;
  ARM_REG_R1: number;
  ARM_REG_R2: number;
  ARM_REG_R3: number;
  ARM_REG_R4: number;
  ARM_REG_R5: number;
  ARM_REG_R6: number;
  ARM_REG_R7: number;
  ARM_REG_R8: number;
  ARM_REG_R9: number;
  ARM_REG_R10: number;
  ARM_REG_R11: number;
  ARM_REG_R12: number;
  ARM_REG_SP: number;
  ARM_REG_LR: number;
  ARM_REG_PC: number;
  ARM_REG_C1_C0_2: number;
  ARM_REG_FPEXC: number;
  [key: string]: number;
  Unicorn: new (arch: number, mode: number) => UnicornHandle;
}

declare global {
  function MUnicorn(): Promise<UnicornModule>;
  function MKeystone(): Promise<KeystoneModule>;
}
