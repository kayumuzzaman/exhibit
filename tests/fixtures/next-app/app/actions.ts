'use server';

export async function saveProfile(displayName: string) {
  return { ok: true, displayName, savedBy: 'server-action' };
}

export async function failingAction() {
  throw new Error('fixture action failure');
}
