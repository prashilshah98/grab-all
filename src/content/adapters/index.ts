import type { Adapter } from '../types';
import { filester } from './filester';
import { gofile } from './gofile';
import { koofr } from './koofr';

const adapters: Adapter[] = [filester, koofr, gofile];

export function findAdapter(hostname: string): Adapter | undefined {
  return adapters.find((a) => a.hosts.includes(hostname));
}
