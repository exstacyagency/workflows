# Data Retention Policy

This document describes the current retention posture of the platform.

## Status

This is a practical operating policy for the current implementation.

Current default policy:
- project data and generated artifacts are retained indefinitely until deleted by the owner, an admin action, or a cleanup operation

That is sufficient for current buyer disclosure, but it should be treated as a baseline policy rather than a fully automated retention program.

## Retention rule by category

### 1. Core project and run data

Retained until deleted:

- projects
- products
- research runs
- jobs
- scripts
- storyboards
- storyboard scenes
- characters
- product intelligence / product intel records
- customer analysis outputs
- pattern analysis outputs

Deletion today:
- run-level deletion exists and removes many linked artifacts with the run
- some scoped delete endpoints exist for research rows, assets, and related records
- full tenant-wide purge is not yet implemented

### 2. Research data

Retained until deleted:

- research rows
- Amazon review rows
- uploaded research data
- ad assets and related metadata
- OCR text
- transcripts

Deletion today:
- run-level deletion and several research-scoped delete flows exist
- project-wide purge is not yet complete across all artifact classes

### 3. Generated creative artifacts

Retained until deleted:

- scripts
- storyboard metadata
- video prompts
- first/last frame references
- generated video URLs persisted to records
- swapped audio references

Deletion today:
- much of this is deleted when a run is deleted
- platform does not yet guarantee storage-object cleanup for every external file on every delete path

### 4. Storage objects

Retained until deleted:

- product setup reference images
- avatar images
- mirrored ad videos
- video frame images
- trimmed clips
- swapped audio assets

Current behavior:
- the application stores URLs and deletes some parent DB records
- storage lifecycle cleanup is not yet documented as a complete, automated retention process for every bucket/object class

### 5. Logs and audit records

Current policy:
- retained indefinitely until manually deleted or removed by underlying infrastructure retention behavior

Includes:

- audit log records stored in the database
- application logs emitted by app/workers
- provider-side logs outside this system

Current gap:
- there is not yet a documented enforced retention window for audit/application logs

## Export before delete

Current capability:
- research export endpoints and CSV exports exist for some data classes

Current limitation:
- there is not yet a full project export bundle covering all files and DB artifacts in one operation

Policy statement:
- when feasible, export should be offered before destructive deletion
- today this is only partially implemented

## Tenant deletion

Current state:
- tenant-wide delete/purge is not implemented

Policy implication:
- “delete everything for this account” is not yet a single supported operation

## Buyer disclosure summary

The buyer should understand the current retention posture as:

- business/project data is generally retained indefinitely
- deletion is primarily manual or triggered through scoped product/run/data deletes
- some export capability exists, but not a full-platform export bundle
- audit/log retention is not yet enforced by a formal automated policy

## Simple policy statement

For diligence purposes, the platform’s current written policy is:

> Customer project data, generated artifacts, and related logs are retained indefinitely until deleted through platform delete actions, infrastructure cleanup, or manual administrative intervention.

## Recommended future hardening

Not required for this disclosure, but recommended post-transfer:

- define explicit audit-log retention window
- define storage-object retention and cleanup behavior per bucket
- implement project-wide purge
- implement tenant-wide purge
- implement full export-before-delete bundle
