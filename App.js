import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useContext,
} from 'react';

import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';

import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

import BackgroundTimer from 'react-native-background-timer';
import BleManager from 'react-native-ble-manager';
import VIForegroundService from '@voximplant/react-native-foreground-service';
import GetLocation from 'react-native-get-location';
import MMKV from 'react-native-mmkv-storage';
import NetInfo from '@react-native-community/netinfo';

import SharingScreen from './screens/sharingScreen';
import GreetingScreen from './screens/greetingScreen';
import AskBluScreen from './screens/askForBluetoothScreen';

import FxContext from './FxContext';

import uploadContact from './utilities/uploadContact';
import registerDevice from './utilities/registerDevice';

import {TextareaItem, WingBlank, Button} from '@ant-design/react-native';

const Stack = createStackNavigator();

var Buffer = require('buffer/').Buffer;

var formatISO9075 = require('date-fns/formatISO9075');

const {BleModule, ToastModule} = NativeModules;

// to register event listeners on BleManager from 'react-native-ble-manager'
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);
// to register event listers on BleModule.java
const bleModuleEmitter = new NativeEventEmitter(BleModule);

const App = () => {
  // declare state variables
  const [isBleSupported, setIsBleSupported] = useState(false);
  const [currentDiscoveredDevices, setCurrentDiscoveredDevices] = useState([]);
  const [discoveryLog, setDiscoveryLog] = useState([]);
  const [recognizedDevices, setRecognizedDevices] = useState([]);
  const [dataForDisplay, setDataForDisplay] = useState('');
  const [location, setLocation] = useState([]);
  const [isConnectedToNet, setIsConnectedToNet] = useState(false);
  const [nodeId, setNodeId] = useState(null);

  // decalre references that will store previous state values
  var intervalRef = useRef(null);
  const currentDiscoveredDevicesRef = useRef();
  const discoveryLogRef = useRef();
  const isBleSupportedRef = useRef();
  const recognizedDevicesRef = useRef();
  const locationRef = useRef();
  const isConnectedToNetRef = useRef();
  const nodeIdRef = useRef();

  // FxProvider value set as state in FxContext, tagged in index.js
  const {mFunc, setMFunc} = useContext(FxContext);

  // instantiate key-value storage with ID
  var MmkvStore = new MMKV.Loader().withInstanceID('bleDiscoveryLogs');
  //console.log(MmkvStore)

  // note: useEffect runs *after* the DOM is painted (after render, as 
  // a "side effect")
  useEffect(() => {
    //Starts BLEManager
    BleManager.start({showAlert: false});

    // ADD EVENT LISTENERS

    // Listen to discovery event 'BleManagerDiscoverPeripheral', see:https://github.com/innoveit/react-native-ble-manager 
    // and pass the event params to handleDiscoverPeripheral
    // this even looks for peripherals
    const handlerDiscover = bleManagerEmitter.addListener(
      'BleManagerDiscoverPeripheral',
      handleDiscoverPeripheral,
    );
    // event when peripheral scanning has ended
    const handlerStopScan = bleManagerEmitter.addListener(
      'BleManagerStopScan',
      handleStopScan,
    );

    const debuggingHandler = bleModuleEmitter.addListener(
      'forConsoleLogging',
      handleConsoleLog,
    );

    const netStatHandler = NetInfo.addEventListener(state => {
      let netStat = state.isInternetReachable;
      setIsConnectedToNet(netStat);
      console.log('network state', netStat);
    });

    // assign functions to mFunc in FxContext, mFuncs r used in screens
    setMFunc({
      enableBluetooth,
      startMonitoring,
      stopMonitoring,
      getNodeId,
      nodeIdRef,
    });
    initializeLocalStore();

    getLocation(); // assign value to location state
  }, []);

  useEffect(() => {
    discoveryLogRef.current = discoveryLog;
  }, [discoveryLog]);

  useEffect(() => {
    currentDiscoveredDevicesRef.current = currentDiscoveredDevices;
    //console.log('current Discovered Devices', currentDiscoveredDevices);
  }, [currentDiscoveredDevices]);

  useEffect(() => {
    isBleSupportedRef.current = isBleSupported;
  }, [isBleSupported]);

  useEffect(() => {
    recognizedDevicesRef.current = recognizedDevices;
  }, [recognizedDevices]);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    isConnectedToNetRef.current = isConnectedToNet;
  }, [isConnectedToNet]);

  useEffect(() => {
    nodeIdRef.current = nodeId;
  }, [nodeId]);

  // get device android ID
  const getNodeId = useCallback(
    () =>
      new Promise(async (resolve, reject) => {
        //CHECKOUT if node_id changes at reinstall, and so display the node_id on screen
        try {
          // set android id if available
          let node_id = (await MmkvStore.getStringAsync('node_id')) || null;
          setNodeId(node_id);
          resolve();
        } catch (err) {
          console.log('node_id not found', err);
          // if err, register node id
          if (isConnectedToNetRef.current) {
            let cancel = {exec: null};
            const regTOId = BackgroundTimer.setTimeout(() => {
              cancel.exec(); // is exec:null executable?
            }, 180000);

            registerDevice(cancel) // gets androidId from device & inserts it to api.traceph.org
              .then(async node_id => {
                try {
                  // store retreived node_id
                  await MmkvStore.setStringAsync('node_id', node_id);
                  setNodeId(node_id);
                  resolve();
                } catch (err) {
                  console.log('local storage cant update', err);
                  reject();
                }
              })
              .catch(err => {
                console.log('registering error', err);
                ToastModule.showToast('Internet Connection Needed. Try again.');
                reject();
              })
              .finally(() => {
                BackgroundTimer.clearTimeout(regTOId);
              });
          } else {
            ToastModule.showToast('Internet Connection Needed. Try again.');
            reject();
          }
        }
      }),
    [],
  );

  // initialize MMKVwithID local storage
  const initializeLocalStore = async () => {
    try {
      MmkvStore = await MmkvStore.initialize();
    } catch (err) {
      console.log('store initialization failed. ', err);
    }
  };

  // check availability and acquire permission to turn BLE on
  const enableBluetooth = useCallback(
    () =>
      new Promise((resolve, reject) => {
        // acquire permission
        if (Platform.OS === 'android' && Platform.Version >= 23) {
          PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          ).then(result => {
            if (result) {
              console.log('Android Permission is OK');
            } else {
              PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
              ).then(result => {
                if (result) {
                  console.log('User accept');
                } else {
                  console.log('User refuse');
                  reject();
                }
              });
            }
          });
        }
        //Enables Bluetooth
        BleManager.enableBluetooth()
          .then(() => { // then setState based on BleModule advert avail check
            BleModule.isAdvertisingSupported(res => {
              setIsBleSupported(res);
            });
            console.log('The bluetooth is already enabled or the user confirm');
            setTimeout(() => resolve(), 1000);
          })
          .catch(error => {
            ToastModule.showToast("Can't operate without bluetooth.");
            console.log('The user refuse to enable bluetooth');
            reject();
          });
      }),
    [],
  );

  // create the required notification channel and runs corresponding service in
  // the background while displaying notification. 
  // VIForegroundService is tied to ap p via AndroidManifest.xml
  const startForegroundService = async () => {
    if (Platform.Version >= 26) {
      const channelConfig = {
        id: 'detectPHServiceChannel',
        name: 'detectPH Channel',
        description: 'Notification Channel for detectPH',
        enableVibration: false,
        importance: 2,
      };
      await VIForegroundService.createNotificationChannel(channelConfig);
    }

    const notificationConfig = {
      id: 9811385, // unique id
      title: 'detectPH Active',
      text: 'The app is running in the background.',
      icon: 'ic_launcher_round',
    };
    if (Platform.Version >= 26) {
      notificationConfig.channelId = 'detectPHServiceChannel';
    }
    try {
      await VIForegroundService.startService(notificationConfig);
      console.log('service good.');
    } catch (e) {
      console.error(e);
    }
  };

  const stopForegroundService = async () => {
    let returnVal = false;
    await VIForegroundService.stopService()
      .then(() => {
        returnVal = true;
      })
      .catch(() => {
        returnVal = false;
      });
    return returnVal;
  };

  // stops apps's overall close-contact monitoring
  const stopMonitoring = useCallback(
    () =>
      new Promise((resolve, reject) => {
        stopAdvertising();
        stopTimer();
        if (stopForegroundService()) resolve();
        else reject();
      }),
    [],
  );

  // assign location to location-state
  const getLocation = () => {
    GetLocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 5000,
    })
      .then(locDeets => {
        const {longitude, latitude, time} = locDeets;
        let mLocation = [longitude, latitude, time];
        setLocation(mLocation);
      })
      .catch(error => {
        const {code, message} = error;
        console.warn(code, message);
      });
  };

  const startTimer = useCallback(
    () =>
      new Promise((resolve, reject) => {
        getLocation(); // TODO: TIMEOUT location
        // runs async function every 7 seconds
        intervalRef.current = BackgroundTimer.setInterval(async () => {
          const deviceToConnect = [];
          const temp_recognizedDevices = [...recognizedDevicesRef.current];
          console.log('recognizedDevices', temp_recognizedDevices);
          console.log('discovery log', discoveryLogRef.current);

          const segregateList = item =>
            new Promise(resolve => {
              if (item.data === '') { 
                deviceToConnect.push(item);
              } else {
                temp_recognizedDevices.push(item);
              }

              resolve();
            });

          // for each item in currentDiscovDevices, check if it's in recognizedDevices
          // if not, add it to deviceToConnect if its data is empty (segregate)
          // else add it to recognizedDevices
          currentDiscoveredDevicesRef.current.forEach(async item => {
            function checkIfRecognized(obj) {
              return obj.id === item.id;
            }
            let isRecognized = temp_recognizedDevices.some(checkIfRecognized);
            //console.log(item.id, 'is recognized', isRecognized);
            if (!isRecognized) {
              await segregateList(item);
            }
          });

          // connect to each segregated device, read characteristic data, then
          // finally update recognized devices
          for (let i = 0; i < deviceToConnect.length; i++) {
            let isConnected = false;
            var id = deviceToConnect[i].id;
            //console.log('connecting to device ', id);
            await BleManager.connect(id)
              .then(() => {
                console.log('Connected to ', id);
                isConnected = true;
              })
              .then(() => {
                return BleManager.retrieveServices(id);
              })
              .then(info => {
                console.log('Retrieved services of peripheral: ', id, info);
              })
              .then(async () => {
                console.log('reading data from ', id);
                await BleManager.read(
                  id, // peripheral
                  '0000ff01-0000-1000-8000-00805F9B34FB', //serviceUUID
                  '0000ff01-0000-1000-8000-00805F9B34FB', //characUUID
                  // UUID's are declared and used in BleModule.java
                )
                  .then(readData => { // when data is read, add as recog device
                    var buffer = Buffer.from(readData);
                    const serviceData = buffer.toString();
                    //set the serviceData to data
                    deviceToConnect[i].data = serviceData;
                    temp_recognizedDevices.push(deviceToConnect[i]);
                    console.log('received service data ', serviceData);
                  })
                  .catch(err => {
                    console.log('read error', err);
                  })
                  .finally(() => { // after trying to read data, disconnect from periph
                    if (isConnected) {
                      BleManager.disconnect(id, true)
                        .then(() => {
                          isConnected = false;
                        })
                        .catch(err => {
                          console.log('disconnect error', err);
                        });
                    }
                  });
              })
              .catch(error => {
                console.log('getting Service Data failed: ', error);
                if (isConnected) {
                  BleManager.disconnect(id, true)
                    .then(() => {
                      isConnected = false;
                    })
                    .catch(err => {
                      console.log('disconnect error', err);
                    });
                }
              });
          }
          setRecognizedDevices(temp_recognizedDevices); // update recognized devs

          //get local storage
          var localStorage = [];
          try {
            localStorage = (await MmkvStore.getArrayAsync('discLogs')) || []; // get storage if it exists, or empty array 
            console.log('localStorage', localStorage);
            let mtext = JSON.stringify(localStorage);
            setDataForDisplay(mtext);
          } catch (err) {
            console.log('local storage not found', err);
          }

          // check for every value in discoveryLog if it's on recogDevs, if yes
          // then add that device's' info to localStorage
          // That is, if it was discovered and it's deviceName/androidID was collected
          // then add to localstorage for uploading
          discoveryLogRef.current.forEach(val => {
            function checkIfOnRecognized(obj) {
              return obj.id === val.id;
            }
            let recogDevIndex = temp_recognizedDevices.findIndex(
              checkIfOnRecognized,
            );
            if (recogDevIndex >= 0) { //collect contact info to upload
              let contact = {
                type: 'direct-bluetooth',
                timestamp: val.time,
                source_node_id: nodeIdRef.current,
                node_pair: temp_recognizedDevices[recogDevIndex].data,
                location: {type: 'Point', coordinates: locationRef.current},
                rssi: val.rssi,
                txPower: temp_recognizedDevices[recogDevIndex].txPower,
              };
              localStorage.push(contact);
            }
          });

          // if there's internet, upload contact (POST)
          if (isConnectedToNetRef.current && localStorage.length !== 0) {
            //TODO transfer timer to upoad contact
            console.log('uploading contact');
            await uploadContact(localStorage, BackgroundTimer)
              .then(() => {
                localStorage = [];
              })
              .catch(err => {
                console.log('upload error', err);
              });
          }
          try { // update 'discLogs' with localStorage
            await MmkvStore.setArrayAsync('discLogs', localStorage);
            console.log('localStorage',localStorage)
          } catch (err) {
            console.log('local storage cant update', err);
          }

          // end of commands for one 7sec interval, clear arrays
          console.log('ending a run');
          setCurrentDiscoveredDevices([]);
          setDiscoveryLog([]);
          startScan(true); //TODO why is there a startScan here, when there is also one in startMonitoring?
        }, 7000); // 

        if (intervalRef.current) {
          console.log('timer started');
          resolve();
        } else {
          reject();
        }
      }),
    [],
  );

  const stopTimer = useCallback(() => {
    BackgroundTimer.clearInterval(intervalRef.current);
  }, []);

  const startAdvertising = () =>
    new Promise((resolve, reject) => {
      if (isBleSupportedRef.current) {
        BleModule.advertise(nodeIdRef.current, (res, err) => {
          if (res) { // if advert successfully started
            console.log('advertising');
            resolve();
          } 
        });
      } else { // if not supported
        reject();
      }
    });

  const startServer = () =>
    new Promise((resolve, reject) => {
      if (isBleSupportedRef.current) {
        BleModule.startServer((res, err) => {
          if (res) {
            console.log('gatt started');
            resolve();
          }
        });
      } else {
        reject();
      }
    });

  const stopAdvertising = () => {
    BleModule.stopBroadcastingGATT((res, res1, err) => {
      // if (res) setIsAdvertising(false);
    });
  };

  // scan for periphs with service UUID as below, for 3 seconds, allow
  // duplicate
  const startScan = isUseUuid =>
    new Promise((resolve, reject) => {
      let scanUuids = [];
      if (isUseUuid) scanUuids = ['0000ff01-0000-1000-8000-00805F9B34FB'];
      BleManager.scan(scanUuids, 3, true)
        .then(results => {
          console.log('Start scan');
          resolve();
        })
        .catch(() => {
          reject();
        });
    });

  const handleStopScan = () => {
    console.log('Scan done.');
  };

  const handleDiscoverPeripheral = peripheral => {
    var serviceData = '';
    let date = new Date().getDate(); //Current Date
    let month = new Date().getMonth() + 1; //Current Month
    let year = new Date().getFullYear(); //Current Year
    let hours = new Date().getHours(); //Current Hours
    let min = new Date().getMinutes(); //Current Minutes
    let sec = new Date().getSeconds(); //Current Seconds

    let timeStamp = formatISO9075(new Date(year, month, date, hours, min, sec));

    function checkIfExistInLog(obj) {
      return obj.id === peripheral.id && obj.time === timeStamp;
    }

    // check if discovered peripheral is already in discoveryLog
    let logLength = discoveryLogRef.current.length;
    let isPeripheralExisting = discoveryLogRef.current.some(checkIfExistInLog);

    // add peripheral details to states: discoveryLog and
    // currentDiscoveredDevices
    if (logLength === 0 || !isPeripheralExisting) {
      //discoveryLog only records the device id, rssi, and time;
      setDiscoveryLog(currArr => {
        let temp_currArr = [...currArr];
        temp_currArr.push({
          id: peripheral.id,
          rssi: peripheral.rssi,
          time: timeStamp,
        });
        console.log('discoveryLog',peripheral.id, peripheral.name, serviceData, timeStamp);
        return temp_currArr;
      });

      // while currentDiscoveredDevices records id, data, and txPower.
      setCurrentDiscoveredDevices(currentArr => {
        let temp_currentArr = [...currentArr];

        const checkIfIdExist = item => {
          return item.id === peripheral.id;
        };

        // if periph is not yet on currentDiscoveredDevices
        if (temp_currentArr.findIndex(checkIfIdExist) === -1) {
          //get the advertisement data
          if (peripheral.advertising.serviceData.hasOwnProperty('ff01')) {
            var buffer = Buffer.from(
              peripheral.advertising.serviceData.ff01.bytes,
            );
            serviceData = buffer.toString();
          }

          temp_currentArr.push({
            id: peripheral.id,
            data: serviceData,
            txPower: peripheral.advertising.txPowerLevel,
          });
        console.log('added to currentDiscoveredDevices', peripheral.id, peripheral.name, serviceData, timeStamp);
        }

        return temp_currentArr;
      });
    }
  };

  // sort of the Main() function
  const startMonitoring = useCallback(
    () =>
      new Promise(async (resolve, reject) => {
        startAdvertising() // configure adv packet and begin broadcasting
          .then(() => startServer()) // setup GATT server with a Service;
          .then(() => startTimer()) // begin intervals of data-collect and upload
          .then(() => startScan(true)) // scan for avail periphs w/ given servUUIDs
          .then(() => startForegroundService()) // permit running on background
          .then(() => {
            resolve();
          })
          .catch(() => {
            reject();
          });
      }),
    [],
  );

  const handleConsoleLog = msg => {
    console.log('from native: ', 'msg');
  };

  return (
    <React.Fragment>
      {/* <WingBlank>
        <TextareaItem
          rows={8}
          placeholder="discovery logs"
          value={dataForDisplay}
        />
      </WingBlank> */}
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Greet" headerMode="none">
          <Stack.Screen name="Greet" component={GreetingScreen} />
          <Stack.Screen name="askForBluetooth" component={AskBluScreen} />
          <Stack.Screen name="Sharing" component={SharingScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </React.Fragment>
  );
};

export default App;
