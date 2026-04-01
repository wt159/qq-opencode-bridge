import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessManager } from '../src/modules/process.js';

describe('ProcessManager', () => {
  let mgr: ProcessManager;
  beforeEach(() => { mgr = new ProcessManager([3002, 3010]); });

  it('allocates ports sequentially', () => {
    const p1 = mgr.allocatePort();
    const p2 = mgr.allocatePort();
    expect(p2).toBe(p1 + 1);
  });

  it('tracks running instances', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    const instances = mgr.getInstances();
    expect(instances.size).toBe(1);
    expect(instances.get('/proj/a')?.port).toBe(3002);
  });

  it('removes instances', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    mgr.removeInstance('/proj/a');
    expect(mgr.getInstances().size).toBe(0);
  });

  it('finds instance by path', () => {
    mgr.addInstance('/proj/a', 3002, 1234);
    const inst = mgr.getInstance('/proj/a');
    expect(inst?.port).toBe(3002);
  });
});
