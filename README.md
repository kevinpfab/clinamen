# Clinamen

A standalone interactive piece built with Vite, TypeScript, and Three.js.
The production bundle is hosted at <https://kevinpfab.com/clinamen/> by the
separate kevinpfabdotcom Astro project.

## Development

Use Bun 1.3.14 (declared in `package.json`) and Node.js 24, matching release CI.

```sh
bun install --frozen-lockfile
bun run dev
```

Validate changes with:

```sh
bun run lint && bun test && bun run build
```

The production output is `dist/`. Vite's `base: "./"` keeps bundled asset
references relative so the output can be served under `/clinamen/`.

## Releases

One-time repository setup: enable **Settings → General → Releases → Enable
release immutability** on GitHub. The workflow uses the repository's
`GITHUB_TOKEN` with `contents: write`; no website or hosting credentials are
needed. Repository or organization policy must allow that permission.

Commit and push the version you want to release, including the release workflow,
then tag that commit:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Use a new `vMAJOR.MINOR.PATCH` tag for every release. The tag is the release
version; `package.json` is private and its version is not used for bundle
identification. Prerelease tags are not currently supported. Never move a
published tag or replace its bundle.

[The release workflow](.github/workflows/release.yml) checks out the tagged
commit, installs locked dependencies, runs lint, tests, and the production build,
then adds `dist/build-info.json`:

```json
{
  "project": "clinamen",
  "version": "v0.1.0",
  "commit": "<full source commit SHA>"
}
```

It publishes two assets:

- `clinamen.tar.gz`: the contents of `dist/`, with `index.html` and
  `build-info.json` at the archive root, without a containing `dist/` directory.
- `clinamen.tar.gz.sha256`: the archive's SHA-256 in `sha256sum` format.

The workflow uploads both assets to a draft before publishing. If a run fails
before publication, fix transient issues and rerun it; it can replace assets
on the unpublished draft. A run refuses to overwrite a published release.
If a fix requires a code or workflow change, commit it and use a new tag.

The release notes and successful workflow summary include the exact archive
URL, checksum, and source commit for the website handoff. For example:

```text
https://github.com/kevinpfab/clinamen/releases/download/v0.1.0/clinamen.tar.gz
```

Use the uploaded asset, not GitHub's automatically generated source archive.
`build-info.json` identifies the build; it is not a signed provenance statement.

## Website handoff

In kevinpfabdotcom:

1. Commit a manifest pinning the release tag, exact archive URL, SHA-256, and
   source commit. Do not resolve `latest` during builds.
2. Before `astro build`, download to a temporary location and verify the bytes
   against the committed SHA-256. Reject failed downloads or mismatches.
3. Extract safely into a temporary directory, rejecting paths that escape it
   and archive links. Require `index.html` and verify `build-info.json` against
   the manifest's project, version, and commit.
4. Replace the generated, gitignored `public/clinamen/` directory with the
   verified contents. Astro copies these files unchanged into its build output.
   Fail the build on import errors instead of silently using an old bundle.
5. Run the same preparation step for local development. The developer controls
   starting the dev server.
6. Configure the host to redirect `/clinamen` to `/clinamen/` so relative asset
   references resolve correctly. Add the page to site navigation and the sitemap
   as desired; static files in `public/` are not Astro page routes.

Updating the manifest selects a new release; reverting it selects an older one.
The website owns deployment and hosting. If this repository is private, its
build environment also needs credentials with read access to the release assets.
