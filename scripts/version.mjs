/* eslint-disable no-console */
import cp from 'child_process'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { dirname, resolve as pathResolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const __root = pathResolve(__dirname, '..')

const semverRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/

const isSemverHint = (input) =>
  typeof input === 'string' && ['major', 'minor', 'patch'].includes(input)

const exec = async (cmd, args, opts = { encoding: 'buffer' }) =>
  new Promise((resolve, reject) => {
    cp.execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        console.error(err)
        console.error(stderr)
        reject(err)
      } else {
        console.log(`[${[cmd, ...args].join(' ')}]: done`)
        resolve([true, stdout])
      }
    })
  })

const getArgs = () => {
  const { argv: [,, nextVersion] } = process

  if (typeof nextVersion !== 'string') {
    throw new TypeError('First arg must be a string')
  }

  return {
    hint: isSemverHint(nextVersion),
    required: nextVersion,
  }
}

const queryVersion = async (workingDir) =>
  readFile(`${workingDir}/package.json`)
    .then((content) => JSON.parse(content.toString()))
    .then(({ version }) => (version.match(semverRegex) ? version : undefined))
    .catch(() => {
      throw new TypeError(`No package.json file found at ${workingDir}`)
    })

const updateChangelog = async (workingDir, version) => {
  const changelogPath = pathResolve(workingDir, 'CHANGELOG.md')

  if (!version) {
    return
  }

  if (!existsSync(changelogPath)) {
    console.warn('No CHANGELOG.md file found')
    return
  }

  return readFile(changelogPath)
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
      return writeFile(changelogPath, output.join('\n'))
    })
    .then(() => changelogPath)
    .catch((err) => {
      console.error(err.message)
      return undefined
    })
}

const main = async () => {
  const { required, hint } = getArgs()

  const workingDir = __root
  await exec('yarn', ['version', required])

  let newVersion = required
  if (hint) {
    newVersion = await queryVersion(workingDir)
  }

  const changelogPath = await updateChangelog(workingDir, newVersion)

  // git
  const tag = `v${newVersion}`
  const tagScope = '@micro-lc/compose-toolkit'
  const message = `${tagScope} tagged at version ${newVersion}`
  /** @type {string[]} */
  const files = [
    pathResolve(workingDir, 'package.json'),
    pathResolve(workingDir, '.yarn/versions'),
    changelogPath,
  ].filter(Boolean)
  await exec('git', ['reset'])
  await exec('git', ['add', ...files])
  await exec('git', ['commit', '-nm', message])
  await exec('git', ['tag', '-a', tag, '-m', message])

  const pushCommand = `"git push && git push origin ${tag}"`
  console.group()
  console.log(pushCommand)
  console.groupEnd()
}

main()
  .catch(console.error)
