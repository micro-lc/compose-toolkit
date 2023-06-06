import cp from 'child_process'
import fs from 'fs'
import path from 'path'

import type IPackageJson from '@ts-type/package-dts'
import { Command } from 'commander'
import logger from 'node-color-log'

logger.setDate(() => '')

const colorMap = {
  error: 'red' as const,
  stderr: 'yellow' as const,
  stdout: 'green' as const,
}

const workingDir = path.resolve(__dirname)

class PromiseQueue {
  private queue: Promise<void>

  constructor() {
    this.queue = Promise.resolve()
  }

  get() {
    return this.queue
  }

  add(step: string, operation: () => Promise<void>) {
    this.queue = this.queue
      .then(operation)
      .then(() => {
        logger.bgColor('green').log(`[${step}]`)
          .joint()
          .color('white')
          .log(` ▶ OK\n`)
      }).catch((err) => {
        logger.bgColor('magenta').log(`[${step}]`)
          .joint()
          .color('white')
          .log(` ▶ Failed\n`)
        throw err
      })
    return this.queue
  }
}

const exec = async (step: string, command: string, args: string[] = []) => {
  let innerResolve: () => void
  let innerReject: (reason?: unknown) => void
  const promise = new Promise<void>((resolve, reject) => {
    innerResolve = resolve
    innerReject = reject
  })

  const proc = cp.execFile(command, args, (error, stdout, stderr) => {
    let color: 'red' | 'yellow' | 'green'
    let message: string
    if (error !== null) {
      color = colorMap.error
      message = `${error.message}\n\n${String(error.stack)}`
    } else if (stderr) {
      color = colorMap.stderr
      message = stderr
    } else {
      color = colorMap.stdout
      message = stdout
    }

    return logger.bgColor(color).log(`[${step}]`)
      .joint()
      .color('white')
      .log(` ▶ ${message}`)
  })
  proc.on('exit', (code) => {
    code === 0
      ? innerResolve()
      : innerReject()
  })

  return promise
}

function getArgs() {
  const program = new Command()
  const ctx: {version?: string} = {}

  program
    .name('bump')
    .description('Command line to handle subpackages version bumps')
    .argument('<version>', `The version to reach. Can be either 'major', 'minor', or 'patch'. Alternatively a specific version can be issued, like '2.1.3-rc2'`)
    .action((version: string | undefined) => {
      ctx.version = version
    })
    .parse()

  return ctx
}

const semverRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/

const queryVersion = async () => fs.promises.readFile(`${workingDir}/package.json`, { encoding: 'utf-8' })
  .then((content) => JSON.parse(content) as IPackageJson)
  .then(({ version }) => version as string)

const querySemVer = async () => fs.promises.readFile(`${workingDir}/package.json`, { encoding: 'utf-8' })
  .then((content) => JSON.parse(content) as IPackageJson)
  .then(({ version }) => (version?.match(semverRegex) ? version : undefined))
  .catch(() => {
    throw new TypeError(`No package.json file found at ${workingDir}`)
  })

const updateChangelog = async (version: string) =>
  fs.promises.readFile(path.resolve(workingDir, 'CHANGELOG.md'))
    .then((content) => {
      const lines = content.toString().split(/(?:\r\n|\r|\n)/g)
      const unreleasedLine = lines
        .findIndex((line) =>
          line
            .trim()
            .replace(/\s/g, '')
            .toLowerCase()
            .match(/^##unreleased/)
        )

      const date = new Date().toISOString()
      const tIndex = date.indexOf('T')

      const output = lines
        .slice(0, unreleasedLine + 1)
        .concat('')
        .concat(`## [${version}] - ${date.slice(0, tIndex)}`)
        .concat('')
        .concat(lines.slice(unreleasedLine + 2))
      return fs.promises.writeFile(path.resolve(workingDir, 'CHANGELOG.md'), output.join('\n'))
    })
    .catch((err: Error) => {
      logger.error(err.message)
      return undefined
    })

async function main() {
  const ctx = getArgs()
  const { version } = ctx

  if (!version) {
    throw new TypeError('version cannot be empty string')
  }

  const queue = new PromiseQueue()

  const tagScope = 'compose-toolkit'
  const tagPrefix = 'v'

  await queue.add('version', () => exec('version', `(cd ${workingDir} ; yarn version ${version})`))

  const newSemVersion = await querySemVer()
  if (newSemVersion !== undefined) {
    await queue.add('update-changelog', () => updateChangelog(newSemVersion))
  }

  await queue.add('reset-stage', () => exec('reset-stage', 'git reset'))
  await queue.add('add-to-stage', () =>
    exec('add-to-stage',
      'git',
      [
        'add',
        path.resolve(workingDir, 'package.json'),
        path.resolve(workingDir, 'CHANGELOG.md'),
        path.resolve(workingDir, '.yarn', 'versions'),
      ]
    )
  )

  const newVersion = await queryVersion()
  await queue.add('commit', () => exec(
    'commit',
    'git',
    [
      'commit',
      '-nm',
      `"${tagScope} tagged at version: ${newVersion}"`,
    ]
  ))

  const tag = `${tagPrefix}${newVersion}`
  await queue.add('commit', () => exec('tag',
    'git',
    [
      'tag',
      '-a',
      `"${tag}" -m "${tagScope} tagged at version: ${newVersion}"`,
    ]
  ))

  return queue.get().then(() => tag)
}

main()
  .then((tag) => {
    logger.color('green').log('\n\tpush both branch and tag:')
    logger.color('magenta').log(`\n\tgit push && git push origin ${tag}`)
  })
  .catch((err) => {
    console.error(`[error boundary]: ${String(err)}`)
  })
