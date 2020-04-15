import {insertContacts} from '../apis/contact';

export default function uploadContact(contactArr) {
  return new Promise((resolve, reject) => {
    insertContacts({
      contacts: contactArr,
    })
      .then(res => {
        console.log('axios connected', [res.status]);
        resolve([]);
      })
      .catch(err => {
        if (err.response) {
          console.log('insert err', err.response.status, err.response.data);
          reject('error sis');
        }
      });
  });
}