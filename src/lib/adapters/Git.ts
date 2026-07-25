import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import FS from '@isomorphic-git/lightning-fs'
import CachingAdapter from './Caching'
import XbelSerializer from '../serializers/Xbel'
import Logger from '../Logger'
import Html from '../serializers/Html'
import {
  FileUnreadableError, GitPushError,
  MissingPermissionsError,
  NetworkError,
  ResourceLockedError,
  SlashError
} from '../../errors/Error'
import Crypto from '../Crypto'
import { Folder, TItemLocation } from '../Tree'

declare const IS_BROWSER: boolean

const LOCK_INTERVAL = 2 * 60 * 1000
const LOCK_TIMEOUT = 15 * 60 * 1000
const NETWORK_RETRIES = 6
const NETWORK_RETRY_DELAY = 1500

// A "Failed to fetch"-style error means the network stack itself couldn't
// reach the host (DNS not ready, VPN tunnel still coming up after a reboot,
// interface down). These are worth retrying and waiting out. Auth failures,
// 404s and git protocol errors are not — retrying them just wastes the budget.
function isNetworkError(e: any): boolean {
  if (!e) return false
  if (e instanceof NetworkError) return true
  // isomorphic-git rethrows the browser fetch TypeError, whose message is
  // "Failed to fetch" (Chromium) / "NetworkError when attempting to fetch
  // resource." (Firefox). It has no HTTP status because no response arrived.
  const msg = String(e.message || '')
  if (e.name === 'TypeError' && /fetch/i.test(msg)) return true
  return /failed to fetch|networkerror when attempting/i.test(msg)
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= NETWORK_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      // Don't burn retries on non-network failures (auth, 404, protocol) —
      // rethrow them immediately.
      if (!isNetworkError(e)) throw e
      if (attempt === NETWORK_RETRIES) {
        // Surface as a NetworkError (a TransientError) so the controller keeps
        // auto-retrying on its schedule instead of treating this as a hard,
        // manual-only error. Fixes "must click Sync now several times" after a
        // reboot while the VPN tunnel is still establishing.
        Logger.log(`(git) ${label} failed after ${NETWORK_RETRIES} network retries: ${e.message}`)
        throw new NetworkError()
      }
      Logger.log(`(git) ${label} network failure (attempt ${attempt}/${NETWORK_RETRIES}): ${e.message}. Retrying...`)
      await new Promise(resolve => setTimeout(resolve, NETWORK_RETRY_DELAY * attempt))
    }
  }
}

export default class GitAdapter extends CachingAdapter {
  private lockingInterval: any
  private lockingPromise: Promise<void>
  private locked: string[]
  private cancelCallback: () => void
  private initialTreeHash: string
  private dir: string
  private hash: string
  private fs: FS|null

  constructor(server) {
    super(server)
    this.server = server
    this.locked = []
    this.lockingInterval = null
  }

  static getDefaultValues() {
    return {
      type: 'git',
      url: 'https://example.org/repo.git',
      username: 'bob',
      password: 's3cret',
      branch: 'main',
      bookmark_file: 'bookmarks.xbel',
      bookmark_file_type: 'xbel',
      includeCredentials: false,
      allowRedirects: false,
      allowNetwork: false,
    }
  }

  getLabel():string {
    const data = this.getData()
    const url = new URL(data.url)
    url.protocol = ''
    return data.label || data.username + '@' + url.hostname + ':' + data.bookmark_file
  }

  getData() {
    return { ...GitAdapter.getDefaultValues(), ...this.server }
  }

  cancel() {
    this.cancelCallback && this.cancelCallback()
  }

  getAuthor() {
    return {
      name: this.server.username || 'Floccus bookmarks sync',
      email: this.server.username + '@floccus',
    }
  }

  async getBookmarksTree(): Promise<Folder<TItemLocation>> {
    // setHashSettings is called after onSyncStart only but before getBookmarksTree
    // thus we get the hash here again
    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    return super.getBookmarksTree()
  }

  async onSyncStart(needLock = true, forceLock = false) {
    Logger.log('onSyncStart: begin')

    // Stable hash per account config — no Date.now() to prevent orphaned IndexedDB instances
    this.hash = await Crypto.sha256(JSON.stringify(this.server))
    this.dir = '/' + this.hash + '/'

    if (IS_BROWSER) {
      const browser = (await import('../browser-api')).default
      let hasPermissions, error = false
      try {
        hasPermissions = await browser.permissions.contains({ origins: [this.server.url + '/'] })
      } catch (e) {
        error = true
        console.warn(e)
      }
      const {isOrion} = await browser.storage.local.get({'isOrion': false})
      if (!error && !hasPermissions && !isOrion) {
        throw new MissingPermissionsError()
      }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.fs = new FS(this.hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs: this.fs, dir: this.dir })
    await git.addRemote({
      fs: this.fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })

    try {
      Logger.log('(git) fetch from remote')
      await withRetry(() => git.fetch({
        http,
        fs: this.fs,
        dir: this.dir,
        tags: true,
        pruneTags: true,
        remote: 'origin',
        depth: 10,
        onAuth: () => this.onAuth()
      }), 'fetch')
      Logger.log('(git) checkout branch ' + (this.server.branch))
      await git.checkout({ fs: this.fs, dir: this.dir, ref: this.server.branch })
    } catch (e) {
      if (e && e.code === git.Errors.NotFoundError.code && (e.data.what === 'HEAD' || e.data.what === this.server.branch || e.data.what === 'origin/' + this.server.branch)) {
        Logger.log('(git) writeFile ' + this.dir + '/README.md')
        await this.fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
        Logger.log('(git) add README.md')
        await git.add({fs: this.fs, dir: this.dir, filepath: 'README.md'})
        Logger.log('(git) commit')
        await git.commit({
          fs: this.fs,
          dir: this.dir,
          message: 'Floccus bookmarks update',
          author: this.getAuthor(),
        })
        const currentBranch = await git.currentBranch({fs: this.fs, dir: this.dir})
        if (currentBranch && currentBranch !== this.server.branch) {
          await git.renameBranch({ fs: this.fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
        }
        Logger.log('(git) push')
        const result = await withRetry(() => git.push({
          fs: this.fs,
          http,
          dir: this.dir,
          ref: this.server.branch,
          remoteRef: this.server.branch,
          remote: 'origin',
          onAuth: () => this.onAuth()
        }), 'push')
        if (result.error) {
          throw new GitPushError(result.error)
        }
      } else {
        throw e
      }
    }

    if (this.server.bookmark_file[0] === '/') {
      throw new SlashError()
    }

    if (this.lockingInterval) {
      clearInterval(this.lockingInterval)
    }
    if (forceLock) {
      await this.clearAllLocks()
      await this.setLock()
    } else if (needLock) {
      await this.obtainLock()
    }
    if (needLock || forceLock) {
      this.lockingInterval = setInterval(() => this.setLock(), LOCK_INTERVAL)
    }

    const status = await this.pullFromServer()

    this.initialTreeHash = await this.bookmarksCache.hash(this.hashSettings)

    Logger.log('onSyncStart: completed')

    return status
  }

  async onSyncFail() {
    Logger.log('onSyncFail')
    clearInterval(this.lockingInterval)
    await this.freeLock()
    await this.cleanupIndexedDB()
  }

  async onSyncComplete() {
    Logger.log('onSyncComplete')
    clearInterval(this.lockingInterval)

    this.bookmarksCache = this.bookmarksCache.clone(false)
    const newTreeHash = await this.bookmarksCache.hash(this.hashSettings)
    if (newTreeHash !== this.initialTreeHash) {
      const fileContents = this.server.bookmark_file_type === 'xbel' ? createXBEL(this.bookmarksCache, this.highestId) : createHTML(this.bookmarksCache, this.highestId)
      Logger.log('(git) writeFile ' + this.dir + '/' + this.server.bookmark_file)
      await this.fs.promises.writeFile(this.dir + '/' + this.server.bookmark_file, fileContents, {mode: 0o777, encoding: 'utf8'})
      Logger.log('(git) add ' + this.server.bookmark_file)
      await git.add({fs: this.fs, dir: this.dir, filepath: this.server.bookmark_file})
      Logger.log('(git) commit')
      await git.commit({
        fs: this.fs,
        dir: this.dir,
        message: `Floccus update: ${this.getLabel()}`,
        author: this.getAuthor(),
      })
      try {
        Logger.log('(git) push')
        const result = await withRetry(() => git.push({
          fs: this.fs,
          http,
          dir: this.dir,
          remote: 'origin',
          onAuth: () => this.onAuth()
        }), 'push')
        if (result.error) {
          throw new GitPushError(result.error)
        }
      } catch (e) {
        if (e.code && e.code === git.Errors.PushRejectedError.code) {
          await this.freeLock()
          await this.cleanupIndexedDB()
          throw new ResourceLockedError
        }
        throw e
      }
    } else {
      Logger.log('No changes to the server version necessary')
    }

    await this.freeLock()
    await this.cleanupIndexedDB()
  }

  async cleanupIndexedDB() {
    const dbName = this.hash
    this.fs = null

    try {
      await new Promise(resolve => setTimeout(resolve, 100))

      Logger.log('Deleting IndexedDB: ' + dbName)
      const deleteRequest = indexedDB.deleteDatabase(dbName)

      await new Promise<void>((resolve) => {
        deleteRequest.onsuccess = () => {
          Logger.log('IndexedDB cleanup successful: ' + dbName)
          resolve()
        }
        deleteRequest.onerror = () => {
          Logger.log('IndexedDB cleanup error for ' + dbName + ': ' + deleteRequest.error)
          resolve()
        }
        deleteRequest.onblocked = () => {
          Logger.log('IndexedDB cleanup blocked: ' + dbName)
          setTimeout(() => resolve(), 1000)
        }
      })
    } catch (e) {
      Logger.log('Error during IndexedDB cleanup: ' + e)
    }
  }

  async obtainLock() {
    const tags = await git.listTags({ fs: this.fs, dir: this.dir })
    const lockTag = tags.sort().reverse().find((tag) => tag.startsWith('floccus-lock-'))
    if (lockTag) {
      const dateLocked = Number(lockTag.slice('floccus-lock-'.length))
      if (Date.now() - dateLocked < LOCK_TIMEOUT) {
        throw new ResourceLockedError()
      }
    }

    await this.setLock()
  }

  async setLock() {
    if (!this.fs) {
      Logger.log('(git) setLock: fs is null, skipping')
      return
    }
    this.lockingPromise = (async() => {
      const tag = 'floccus-lock-' + Date.now()
      Logger.log('(git) tag ' + tag)
      await git.tag({ fs: this.fs, dir: this.dir, ref: tag })
      Logger.log('(git) push tag ' + tag)
      const result = await withRetry(() => git.push({ fs: this.fs, http, dir: this.dir, ref: tag, remote: 'origin', onAuth: () => this.onAuth() }), 'push lock tag')
      if (result.error) {
        throw new GitPushError(result.error)
      }
      this.locked.push(tag)
    })()
    await this.lockingPromise
  }

  async onAuth() {
    return { username: this.server.username, password: this.server.password }
  }

  async freeLock() {
    if (this.lockingPromise) {
      await this.lockingPromise
    }
    if (!this.locked.length) {
      return
    }

    try {
      for (const tag of this.locked) {
        Logger.log('(git) push: delete tag ' + tag)
        const result = await git.push({ fs: this.fs, http, dir: this.dir, ref: tag, delete: true, remote: 'origin', onAuth: () => this.onAuth() })
        if (result.error) {
          Logger.log('Failed to delete lock tag ' + tag + ': ' + result.error)
        }
      }
      this.locked = []
      return true
    } catch (e) {
      Logger.log('Error Caught')
      Logger.log(e)
      return false
    }
  }

  async clearAllLocks(fs:FS = null): Promise<void> {
    fs = fs || this.fs
    const tags = await git.listTags({ fs, dir: this.dir })
    const lockTags = tags.filter(tag => tag.startsWith('floccus-lock-'))
    for (const tag of lockTags) {
      const result = await git.push({ fs, http, dir: this.dir, ref: tag, delete: true, remote: 'origin', onAuth: () => this.onAuth() })
      if (result.error) {
        Logger.log('Failed to clear lock tag ' + tag + ': ' + result.error)
      }
    }
  }

  async pullFromServer() {
    let fileContents
    try {
      Logger.log('(git) readFile')
      fileContents = await this.fs.promises.readFile(this.dir + '/' + this.server.bookmark_file, { encoding: 'utf8' })
    } catch (e) {
      this.resetCache()
      // Could not find file
      return false
    }

    if (!fileContents || (!fileContents.includes('<?xml version="1.0" encoding="UTF-8"?>') && !fileContents.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'))) {
      throw new FileUnreadableError()
    }

    /* let's get the highestId */
    for (const line of fileContents.split('\n')) {
      if (line.indexOf('<!--- highestId :') >= 0) {
        const idxStart = line.indexOf(':') + 1
        const idxEnd = line.lastIndexOf(':')

        this.highestId = parseInt(line.substring(idxStart, idxEnd))
        break
      }
    }

    switch (this.server.bookmark_file_type) {
      case 'xbel':
        Logger.log('(git) parse XBEL')
        this.bookmarksCache = XbelSerializer.deserialize(fileContents)
        break
      case 'html':
        Logger.log('(git) parse HTML')
        this.bookmarksCache = Html.deserialize(fileContents)
        break
      default:
        throw new Error('Invalid bookmark file type')
    }

    // Found file, we can keep the cache from the previous run
    return true
  }

  async clearServer() {
    const hash = await Crypto.sha256(JSON.stringify(this.server))
    this.dir = '/' + hash + '/'

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const fs = new FS(hash, {wipe: true})

    Logger.log('(git) init')
    await git.init({ fs, dir: this.dir, defaultBranch: this.server.branch })
    await git.addRemote({
      fs,
      dir: this.dir,
      url: this.server.url,
      remote: 'origin',
      force: true
    })
    await fs.promises.writeFile(this.dir + '/README.md', 'This repository is used to synchronize bookmarks via [floccus](https://floccus.org).', {mode: 0o777, encoding: 'utf8'})
    await git.add({fs, dir: this.dir, filepath: 'README.md'})
    await git.commit({
      fs,
      dir: this.dir,
      message: 'Floccus bookmarks update',
      author: this.getAuthor(),
    })
    const currentBranch = await git.currentBranch({fs, dir: this.dir})
    if (currentBranch && currentBranch !== this.server.branch) {
      await git.renameBranch({ fs, dir: this.dir, ref: this.server.branch, oldref: currentBranch })
    }
    const result = await withRetry(() => git.push({
      fs,
      http,
      dir: this.dir,
      ref: this.server.branch,
      remoteRef: this.server.branch,
      remote: 'origin',
      force: true,
      onAuth: () => this.onAuth()
    }), 'push')
    if (result.error) {
      throw new GitPushError(result.error)
    }
    await withRetry(() => git.fetch({
      http,
      fs,
      dir: this.dir,
      tags: true,
      pruneTags: true,
      remote: 'origin',
      depth: 10,
      onAuth: () => this.onAuth()
    }), 'fetch')
    await this.clearAllLocks(fs)
  }
}

function createXBEL(rootFolder, highestId) {
  let output = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">
<xbel version="1.0">
`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += XbelSerializer.serialize(rootFolder)

  output += `
</xbel>`

  return output
}

function createHTML(rootFolder, highestId) {
  let output = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>`

  output +=
    '<!--- highestId :' +
    highestId +
    `: for Floccus bookmark sync browser extension -->
`

  output += Html.serialize(rootFolder)

  output += '</html>'

  return output
}
