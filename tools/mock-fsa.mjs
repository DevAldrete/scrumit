/**
 * A tiny in-memory model of the File System Access API.
 *
 * It is shared by the FSA adapter tests and the cross-adapter contract suite so
 * the same mock cannot quietly diverge from the one the contract uses.
 */
export class MockFile {
  constructor(name, contents = '') {
    this.kind = 'file'
    this.name = name
    this.contents = contents
  }
  async getFile() {
    return { text: async () => this.contents }
  }
  async createWritable() {
    const self = this
    return {
      async write(data) {
        self.contents = data
      },
      async close() {},
      async abort() {},
    }
  }
}

export class MockDir {
  constructor(name = 'root') {
    this.kind = 'directory'
    this.name = name
    this.children = new Map()
  }
  seed(path, contents) {
    const parts = path.split('/')
    const name = parts.pop()
    let dir = this
    for (const part of parts) {
      if (!dir.children.has(part)) dir.children.set(part, new MockDir(part))
      dir = dir.children.get(part)
    }
    dir.children.set(name, new MockFile(name, contents))
    return this
  }
  async getDirectoryHandle(name, options = {}) {
    const existing = this.children.get(name)
    if (existing) return existing
    if (!options.create) throw new Error(`NotFoundError: ${name}`)
    const dir = new MockDir(name)
    this.children.set(name, dir)
    return dir
  }
  async getFileHandle(name, options = {}) {
    const existing = this.children.get(name)
    if (existing && existing.kind === 'file') return existing
    if (!options.create) throw new Error(`NotFoundError: ${name}`)
    const file = new MockFile(name)
    this.children.set(name, file)
    return file
  }
  async removeEntry(name) {
    if (!this.children.has(name)) throw new Error(`NotFoundError: ${name}`)
    this.children.delete(name)
  }
  async *entries() {
    yield* this.children.entries()
  }
  /** Handy for assertions: flatten to `path -> contents`. */
  flatten(prefix = '') {
    const out = {}
    for (const [name, child] of this.children) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (child.kind === 'file') out[path] = child.contents
      else Object.assign(out, child.flatten(path))
    }
    return out
  }
}
