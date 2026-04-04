import { minimatch } from 'minimatch';
import type { PermissionData, PermissionRule } from '../types.js';

export class PermissionRules {
  constructor(
    private rules: PermissionRule[],
    private defaultAction: 'ask' | 'allow' | 'reject',
  ) {}

  evaluate(permission: PermissionData): 'once' | 'always' | 'reject' | null {
    for (const rule of this.rules) {
      if (this.matchRule(permission, rule)) {
        return rule.response;
      }
    }
    if (this.defaultAction === 'allow') return 'once';
    if (this.defaultAction === 'reject') return 'reject';
    return null;
  }

  private matchRule(permission: PermissionData, rule: PermissionRule): boolean {
    if (permission.pattern) {
      const patterns = Array.isArray(permission.pattern)
        ? permission.pattern
        : [permission.pattern];
      return patterns.some((p) => minimatch(p, rule.pattern));
    }
    return minimatch(`${permission.type}:${permission.title}`, rule.pattern);
  }
}
