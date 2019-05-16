import { useState, useEffect } from 'react';

export function useFetch(request) {
  const [data, setData] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const data = await request();
      setData(data);
      setLoading(false);
    })();
  }, []);

  return [data, loading];
}
