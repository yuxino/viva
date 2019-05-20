import * as React from 'react';
import * as fs from 'fs-extra';
import * as path from 'path';
import { useFetch } from '../hooks';

import Layout from '../components/Layout';

async function readFile() {
  const buffer = await fs.readFile(path.join(__dirname, 'containers/Test.md'));
  return buffer.toString();
}

export default () => {
  return (
    <Layout>
      {/* <MdTextArea /> */}
      123
    </Layout>
  );
};
