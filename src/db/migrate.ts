/**
 * IndexedDB Migration Script for High Desert
 * 
 * Handles schema version upgrades with new fields while preserving existing data.
 * Supports incremental upgrades and rollback capabilities.
 */

import Dexie from 'dexie';
import { db } from './index';
import type { Episode } from './schema';

export interface MigrationConfig {
  version: number;
  description: string;
  upgrade: (tx: any) => Promise<void>;
  downgrade?: (tx: any) => Promise<void>;
}

/**
 * Migration definitions for each schema version
 */
const migrations: MigrationConfig[] = [
  {
    version: 7,
    description: 'Add AI confidence scores and mood tags',
    upgrade: async (tx) => {
      await tx.table('episodes').toCollection().modify((ep: Episode) => {
        if (ep.aiConfidence === undefined) ep.aiConfidence = null;
        if (ep.moodTags === undefined) ep.moodTags = [];
      });
    },
    downgrade: async (tx) => {
      await tx.table('episodes').toCollection().modify((ep: any) => {
        delete ep.aiConfidence;
        delete ep.moodTags;
      });
    }
  },
  {
    version: 8,
    description: 'Add AI series part numbers and notable flags',
    upgrade: async (tx) => {
      await tx.table('episodes').toCollection().modify((ep: Episode) => {
        if (ep.aiSeriesPart === undefined) ep.aiSeriesPart = null;
        if (ep.aiNotable === undefined) ep.aiNotable = false;
      });
    },
    downgrade: async (tx) => {
      await tx.table('episodes').toCollection().modify((ep: any) => {
        delete ep.aiSeriesPart;
        delete ep.aiNotable;
      });
    }
  }
];

/**
 * Get current database version
 */
export async function getCurrentVersion(): Promise<number> {
  try {
    const dbInfo = await db.open();
    return dbInfo.verno;
  } catch (error) {
    console.error('Failed to get current version:', errorrror);
    return 0;
  }
}

/**
 * Check if migration is needed
 */
export async function needsMigration(targetVersion: number = 7): Promise<boolean> {
  const currentVersion = await getCurrentVersion();
  return currentVersion < targetVersion;
}

/**
 * Perform migration to target version
 */
export async function migrateToVersion(targetVersion: number = 7): Promise<void> {
  const currentVersion = await getCurrentVersion();
  
  if (currentVersion >= targetVersion) {
    console.log(`Database already at version ${currentVersion}, no migration needed`);
    return;
  }

  console.log(`Migrating from version ${currentVersion} to ${targetVersion}`);

  // Find applicable migrations
  const applicableMigrations = migrations.filter(
    m => m.version > currentVersion && m.version <= targetVersion
  );

  if (applicableMigrations.length === 0) {
    console.warn(`No migrations found for target version ${targetVersion}`);
    return;
  }

  try {
    // Perform migrations in order
    for (const migration of applicableMigrations.sort((a, b) => a.version - b.version)) {
      console.log(`Applying migration v${migration.version}: ${migration.description}`);
      
      await db.transaction('rw', db.episodes, async (tx) => {
        await migration.upgrade(tx);
      });
      
      console.log(`✓ Migration v${migration.version} completed`);
    }
    
    console.log(`✓ All migrations completed. Database now at version ${targetVersion}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw new Error(`Migration to v${targetVersion} failed: ${error}`);
  }
}

/**
 * Rollback to previous version (for testing/development)
 */
export async function rollbackToVersion(targetVersion: number): Promise<void> {
  const currentVersion = await getCurrentVersion();
  
  if (currentVersion <= targetVersion) {
    console.log(`Already at or below target version ${targetVersion}`);
    return;
  }

  console.log(`Rolling back from version ${currentVersion} to ${targetVersion}`);

  // Find applicable rollbacks
  const applicableRollbacks = migrations.filter(
    m => m.version > targetVersion && m.version <= currentVersion && m.downgrade
  ).sort((a, b) => b.version - a.version);

  try {
    for (const migration of applicableRollbacks) {
      console.log(`Rolling back migration v${migration.version}: ${migration.description}`);
      
      await db.transaction('rw', db.episodes, async (tx) => {
        await migration.downgrade!(tx);
      });
      
      console.log(`✓ Rollback v${migration.version} completed`);
    }
    
    console.log(`✓ Rollback completed. Database now at version ${targetVersion}`);
  } catch (error) {
    console.error('Rollback failed:', error);
    throw new Error(`Rollback to v${targetVersion} failed: ${error}`);
  }
}

/**
 * Auto-migrate on app startup
 */
export async function autoMigrate(): Promise<void> {
  try {
    if (await needsMigration()) {
      await migrateToVersion();
    }
  } catch (error) {
    console.error('Auto-migration failed:', error);
    // Don't block app startup, but log for debugging
  }
}

/**
 * Export migration utilities
 */
export const migration = {
  getCurrentVersion,
  needsMigration,
  migrateToVersion,
  rollbackToVersion,
  autoMigrate
};