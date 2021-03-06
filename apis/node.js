import Axios, {CancelToken} from 'axios';
import {API_URL} from '../configs';

const BASE_URL = `${API_URL}/node`;

export const getNode = () => {
  const local_data = {
    node_id: 'node_id',
    device_id: 'device_id',
    person_id: 'person_id',
  };
  return Axios.get(BASE_URL, {
    params: {
      node_id: 'c78775ed-2e4c-43fd-bd9c-90d203826212',
    },
  });
};

export const insertNode = (payload, cancel) => {
  return Axios({
    method: 'post',
    timeout: 180000,
    url: BASE_URL,
    cancelToken: new CancelToken(c => (cancel.exec = c)),
    data: {device_id: payload},
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
