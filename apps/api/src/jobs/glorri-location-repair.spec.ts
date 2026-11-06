import { applyLocationRepair, planLocationRepair, rollbackLocationRepair, type RepairStore } from './glorri-location-repair';

const row = (over: Partial<{ id: string; externalId: string; location: string; rawPayload: unknown }> = {}) => ({
  id: 'j1',
  externalId: 'glorri:a',
  location: 'Tam ştat',
  rawPayload: { location: 'Bakı, Azərbaycan', detail: { location: 'Tam ştat', employment_type: null } },
  ...over,
});

describe('planLocationRepair', () => {
  it('repairs only when the source shows the misplacement and the listing has a real place', () => {
    expect(planLocationRepair([row()]).items).toEqual([{ id: 'j1', externalId: 'glorri:a', previousLocation: 'Tam ştat', newLocation: 'Bakı, Azərbaycan' }]);
  });

  it('leaves correct locations alone', () => {
    expect(planLocationRepair([row({ location: 'Bakı, Azərbaycan' })]).items).toHaveLength(0);
  });

  it('does not touch rows from other sources', () => {
    const plan = planLocationRepair([row({ externalId: 'hellojob:1' })]);
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it('does not guess when the listing has no trustworthy place', () => {
    for (const listing of [undefined, '', 'Tam ştat', null]) {
      const plan = planLocationRepair([row({ rawPayload: { location: listing, detail: { location: 'Tam ştat' } } })]);
      expect(plan.items).toHaveLength(0);
      expect(plan.skipped[0].reason).toMatch(/no trustworthy location/);
    }
  });

  it('does not repair when the source detail does not show the same misplacement', () => {
    const plan = planLocationRepair([row({ rawPayload: { location: 'Bakı, Azərbaycan', detail: { location: 'Gəncə' } } }), row({ id: 'j2', rawPayload: null })]);
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
  });

  it('repairs each distinct place from its own listing record', () => {
    const plan = planLocationRepair([row(), row({ id: 'j2', externalId: 'glorri:b', rawPayload: { location: 'Gəncə, Azərbaycan', detail: { location: 'Tam ştat' } } })]);
    expect(plan.items.map((i) => i.newLocation)).toEqual(['Bakı, Azərbaycan', 'Gəncə, Azərbaycan']);
  });
});

describe('apply and rollback', () => {
  const memoryStore = (locations: Record<string, string>): RepairStore & { locations: Record<string, string> } => ({
    locations,
    async updateLocation(id, expected, next) {
      if (locations[id] !== expected) return false;
      locations[id] = next;
      return true;
    },
  });

  it('applies, records what changed, and can be rolled back exactly', async () => {
    const store = memoryStore({ j1: 'Tam ştat', j2: 'Yarım ştat' });
    const plan = planLocationRepair([row(), row({ id: 'j2', externalId: 'glorri:b', location: 'Yarım ştat', rawPayload: { location: 'Gəncə, Azərbaycan', detail: { location: 'Yarım ştat' } } })]);
    const { applied, raced } = await applyLocationRepair(plan, store);
    expect(raced).toEqual([]);
    expect(store.locations).toEqual({ j1: 'Bakı, Azərbaycan', j2: 'Gəncə, Azərbaycan' });
    const back = await rollbackLocationRepair(applied, store);
    expect(back.restored).toBe(2);
    expect(store.locations).toEqual({ j1: 'Tam ştat', j2: 'Yarım ştat' });
  });

  it('skips a row the importer changed in the meantime and never overwrites it', async () => {
    const store = memoryStore({ j1: 'Gəncə, Azərbaycan' });
    const { applied, raced } = await applyLocationRepair(planLocationRepair([row()]), store);
    expect(applied).toHaveLength(0);
    expect(raced).toEqual(['j1']);
    expect(store.locations.j1).toBe('Gəncə, Azərbaycan');
  });

  it('rolls back only rows that still hold the repaired value', async () => {
    const store = memoryStore({ j1: 'Bakı, Azərbaycan', j2: 'Sumqayıt' });
    const result = await rollbackLocationRepair(
      [
        { id: 'j1', externalId: 'glorri:a', previousLocation: 'Tam ştat', newLocation: 'Bakı, Azərbaycan', appliedAt: 'x' },
        { id: 'j2', externalId: 'glorri:b', previousLocation: 'Tam ştat', newLocation: 'Bakı, Azərbaycan', appliedAt: 'x' },
      ],
      store,
    );
    expect(result).toEqual({ restored: 1, skipped: ['j2'] });
    expect(store.locations.j2).toBe('Sumqayıt');
  });
});
