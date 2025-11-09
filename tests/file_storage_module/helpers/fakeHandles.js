import { groundTruthTree } from '../../../public/tests/file_storage_module/fixtures/groundTruthManifest.js';

class FakeFileHandle {
  constructor(node) {
    this.kind = 'file';
    this.name = node.name;
    this.path = node.path;
    this.size = node.size ?? 0;
  }
}

class FakeDirectoryHandle {
  constructor(node) {
    this.kind = 'directory';
    this.name = node.name;
    this.children = Array.isArray(node.children) ? node.children : [];
  }

  values() {
    return this.#createIterator((child) => child);
  }

  entries() {
    return this.#createIterator((child) => [child.name, child]);
  }

  async *#createIterator(mapper) {
    for (const child of this.children) {
      yield mapper(this.#wrapChild(child));
    }
  }

  #wrapChild(node) {
    if (node.kind === 'directory') {
      return new FakeDirectoryHandle(node);
    }
    return new FakeFileHandle(node);
  }
}

export const createFakeDirectoryHandle = (node = groundTruthTree) =>
  new FakeDirectoryHandle(node);

export const createFakeNativeHandles = (node = groundTruthTree) => [
  createFakeDirectoryHandle(node)
];
