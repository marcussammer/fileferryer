export const groundTruthTree = {
  name: 'ground-truth',
  kind: 'directory',
  children: [
    { name: 'README.txt', kind: 'file', path: 'README.txt', size: 64 },
    {
      name: 'documents',
      kind: 'directory',
      children: [
        { name: 'report.txt', kind: 'file', path: 'documents/report.txt', size: 58 },
        {
          name: 'notes',
          kind: 'directory',
          children: [
            {
              name: 'todo.md',
              kind: 'file',
              path: 'documents/notes/todo.md',
              size: 58
            }
          ]
        }
      ]
    },
    {
      name: 'media',
      kind: 'directory',
      children: [
        {
          name: 'photos',
          kind: 'directory',
          children: [
            {
              name: 'IMG_0001.jpg',
              kind: 'file',
              path: 'media/photos/IMG_0001.jpg',
              size: 51
            },
            {
              name: 'edited',
              kind: 'directory',
              children: [
                {
                  name: 'IMG_0002.png',
                  kind: 'file',
                  path: 'media/photos/edited/IMG_0002.png',
                  size: 51
                }
              ]
            }
          ]
        },
        {
          name: 'videos',
          kind: 'directory',
          children: [
            {
              name: 'family.mov',
              kind: 'file',
              path: 'media/videos/family.mov',
              size: 45
            },
            {
              name: 'highlights',
              kind: 'directory',
              children: [
                {
                  name: 'clip.mp4',
                  kind: 'file',
                  path: 'media/videos/highlights/clip.mp4',
                  size: 45
                }
              ]
            }
          ]
        }
      ]
    },
    {
      name: 'transfers',
      kind: 'directory',
      children: [
        {
          name: 'incoming',
          kind: 'directory',
          children: [
            {
              name: 'archive.zip',
              kind: 'file',
              path: 'transfers/incoming/archive.zip',
              size: 45
            }
          ]
        }
      ]
    }
  ]
};

export const groundTruthCounts = {
  files: 8,
  directories: 10,
  handles: 1
};

const flattenTree = (node, prefix = '') => {
  const currentPath = prefix ? `${prefix}/${node.name}` : node.name;
  const entries = [
    {
      name: node.name,
      kind: node.kind,
      path: node.kind === 'directory' ? currentPath : node.path ?? currentPath
    }
  ];

  if (node.kind === 'directory' && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      entries.push(...flattenTree(child, currentPath));
    });
  }

  return entries;
};

export const groundTruthEntries = flattenTree(groundTruthTree);

export const groundTruthFileEntries = groundTruthEntries.filter(
  (entry) => entry.kind === 'file'
);

export const createTransientFixture = () =>
  groundTruthFileEntries.map((entry) => ({
    name: entry.name,
    kind: 'file',
    size: 1_024,
    webkitRelativePath: `${groundTruthTree.name}/${entry.path}`,
    path: `${groundTruthTree.name}/${entry.path}`
  }));

export const createNativeHandleFixture = () => [
  {
    name: groundTruthTree.name,
    kind: 'directory',
    children: groundTruthTree.children
  }
];

export default {
  groundTruthTree,
  groundTruthCounts,
  groundTruthEntries,
  groundTruthFileEntries,
  createTransientFixture,
  createNativeHandleFixture
};
