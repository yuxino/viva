import * as React from 'react';
import * as fs from 'fs-extra';
import * as path from 'path';
import { useFetch } from '../hooks';

import MdPreview from '../components/MdPreview';
import Layout from '../components/Layout';

async function readFile() {
  const buffer = await fs.readFile(path.join(__dirname, 'containers/Test.md'));
  return buffer.toString();
}

function MdTextArea() {
  return <textarea />;
}

export default () => {
  const [content, loading] = useFetch(readFile);
  return (
    <Layout>
      <MdTextArea />
      {loading ? <p>Loading Content</p> : <MdPreview content={content} />}
    </Layout>
  );
};
