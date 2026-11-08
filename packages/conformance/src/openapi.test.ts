import { endpoints } from '@forgemind/contract';
import { describe, expect, it } from 'vitest';

import {
  contractPath,
  implementedFromDocument,
  isImplemented,
} from './openapi';

describe('reading what a service implements', () => {
  it('maps OpenAPI paths onto the contract', () => {
    expect(contractPath('/tasks/{id}/runs')).toBe('/tasks/:id/runs');
    const implemented = implementedFromDocument({
      paths: { '/health': { get: {} }, '/tasks/{id}': { get: {}, post: {} } },
    });
    expect(isImplemented(implemented, endpoints.health)).toBe(true);
    expect(isImplemented(implemented, endpoints.task)).toBe(true);
    expect(isImplemented(implemented, endpoints.tasks)).toBe(false);
  });

  it('matches a route whatever the parameter is called', () => {
    const implemented = implementedFromDocument({
      paths: { '/organization/members/{user_id}': { patch: {}, delete: {} } },
    });
    expect(isImplemented(implemented, endpoints.updateMemberRole)).toBe(true);
    expect(isImplemented(implemented, endpoints.removeMember)).toBe(true);
    expect(isImplemented(implemented, endpoints.members)).toBe(false);
  });

  it('treats a service without a document as implementing everything', () => {
    expect(isImplemented('all', endpoints.usage)).toBe(true);
  });
});
