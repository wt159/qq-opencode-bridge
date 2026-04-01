import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import type { ProjectInstance } from '../types.js';
import { info, error } from '../utils/logger.js';

export class ProcessManager {
  private instances = new Map<string, ProjectInstance & { proc: ChildProcess }>();
  private portRange: [number, number];
  private nextPort: number;

  constructor(portRange: [number, number]) {
    this.portRange = portRange;
    this.nextPort = portRange[0];
  }

  allocatePort(): number {
    const port = this.nextPort;
    this.nextPort++;
    if (this.nextPort > this.portRange[1]) {
      this.nextPort = this.portRange[0];
    }
    return port;
  }

  startInstance(
    binaryPath: string,
    projectPath: string,
    port: number,
    password?: string,
  ): Promise<ProjectInstance> {
    return new Promise((resolve, reject) => {
      if (!existsSync(projectPath)) {
        reject(new Error(`Project directory not found: ${projectPath}`));
        return;
      }

      const env = {
        ...process.env,
        ...(password ? { OPENCODE_SERVER_PASSWORD: password } : {}),
      };

      const proc = spawn(binaryPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
        cwd: projectPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stderr?.on('data', (d) => error(`[opencode:${port}]`, d.toString()));
      proc.on('error', (e) => error(`[opencode:${port}] process error`, e));
      proc.on('exit', (code) => {
        info(`[opencode:${port}] exited with code ${code}`);
        this.instances.delete(projectPath);
      });

      const instance: ProjectInstance & { proc: ChildProcess } = {
        path: projectPath,
        port,
        pid: proc.pid!,
        startedAt: new Date(),
        sessions: new Set(),
        status: 'running',
        proc,
      };

      this.instances.set(projectPath, instance);
      info(`Started OpenCode at ${projectPath} on port ${port} (PID ${proc.pid})`);
      resolve(instance);
    });
  }

  stopInstance(projectPath: string): void {
    const inst = this.instances.get(projectPath);
    if (inst) {
      inst.status = 'stopping';
      inst.proc.kill('SIGTERM');
      this.instances.delete(projectPath);
      info(`Stopped OpenCode at ${projectPath}`);
    }
  }

  stopAll(): void {
    for (const path of this.instances.keys()) {
      this.stopInstance(path);
    }
  }

  getInstance(path: string): ProjectInstance | undefined {
    return this.instances.get(path);
  }

  getInstances(): Map<string, ProjectInstance> {
    const result = new Map<string, ProjectInstance>();
    for (const [k, v] of this.instances) {
      result.set(k, { ...v, sessions: new Set(v.sessions) });
    }
    return result;
  }

  addInstance(path: string, port: number, pid: number): void {
    const proc = { pid, kill: () => {}, on: () => {} } as unknown as ChildProcess;
    this.instances.set(path, {
      path, port, pid, startedAt: new Date(),
      sessions: new Set(), status: 'running', proc,
    });
  }

  removeInstance(path: string): void {
    this.instances.delete(path);
  }
}
