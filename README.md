# Media Engine

> A modern TypeScript framework for searching, aggregating and normalizing metadata about movies, TV series and anime from multiple providers.

---

## 🚧 Project Status

> **Early Design Phase**

Media Engine is currently in the architecture and design stage.

The project is being developed using a **Documentation First** approach.  
Before writing production code, the architecture, domain model, APIs and development standards are fully designed and documented.

---

# What is Media Engine?

Media Engine is an open-source framework that provides a unified interface for working with media data from multiple providers.

Instead of integrating different APIs, parsers and websites separately, developers work with a single abstraction layer.

Media Engine automatically:

- searches media across multiple providers
- resolves different IDs (IMDb, TMDB, Kinopoisk, Shikimori, etc.)
- normalizes responses
- merges metadata
- discovers available video players
- provides a single strongly typed API

The developer does not need to know where the data comes from.

---

# Why does this project exist?

Today there is no complete TypeScript solution that combines:

- metadata providers
- search providers
- player providers
- ID resolvers
- normalization
- plugin architecture

Most existing libraries solve only one problem.

Media Engine aims to become a universal foundation for media applications.

---

# Main Goals

The project aims to provide:

- Unified media model
- Plugin-based architecture
- High performance
- Strong TypeScript typing
- Extensibility
- Clean Architecture
- Provider abstraction
- Excellent documentation
- Open Source development

---

# Non Goals

Media Engine is **NOT**:

- a streaming service
- a movie website
- a React application
- a frontend framework
- a media player
- a torrent client
- a download manager

Media Engine is an engine that other applications can build upon.

---

# Planned Features

## Metadata

- Movies
- TV Shows
- Anime
- Seasons
- Episodes
- Actors
- Studios
- Genres
- Images
- Ratings
- Videos

---

## Search

Search by:

- Title
- IMDb ID
- TMDB ID
- Kinopoisk ID
- Shikimori ID
- AniList ID

---

## Providers

Planned provider support:

### Metadata

- TMDB
- Kinopoisk.dev
- IMDb
- AniList
- Shikimori

### Players

- Kodik
- Collaps
- VideoCDN
- Lumex
- Alloha

### Images

- TMDB
- FanArt

---

# High-Level Architecture

```text
                Applications

       React      Next.js      CLI
            │         │         │
            └─────────┴─────────┘
                      │
               Media Engine API
                      │
              Search Engine
                      │
          Metadata / Player Engine
                      │
      Provider Plugin System
                      │
 TMDB  IMDb  KP  Kodik  Collaps ...
```

---

# Core Principles

- Documentation First
- Clean Architecture
- SOLID
- DRY
- KISS
- Strong TypeScript Types
- Provider Pattern
- Plugin Architecture
- Testability
- Extensibility

---

# Repository Structure

```text
docs/
apps/
packages/
examples/
tools/
```

(Currently only documentation exists.)

---

# Documentation

Documentation is organized into several sections.

```
docs/

00-overview/

01-architecture/

02-domain/

03-providers/

04-api/

05-development/

06-roadmap/

07-testing/

08-deployment/

adr/
```

---

# Development Roadmap

The project is developed in several phases.

## Phase 0

Architecture

Documentation

Software Design Document

ADR

---

## Phase 1

Workspace

Core

Shared packages

Developer tooling

---

## Phase 2

Domain Model

Provider Contracts

Plugin System

---

## Phase 3

Metadata Providers

TMDB

Kinopoisk

IMDb

AniList

Shikimori

---

## Phase 4

Player Providers

Kodik

Collaps

VideoCDN

Lumex

---

## Phase 5

NestJS API

REST

Swagger

Caching

Queues

---

## Phase 6

React Example Application

---

# Contributing

The project is currently in active design.

Contributions will be accepted after the first public release.

---

# License

MIT

---

Made with ❤️ using TypeScript.