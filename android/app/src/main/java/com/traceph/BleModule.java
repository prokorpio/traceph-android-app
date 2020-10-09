package com.traceph;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.ReactContext;

import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

/** For reference on ff packages, 
 * @see https://developer.android.com/reference/packages
 */
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.BluetoothManager;
import android.os.ParcelUuid;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseCallback;
import android.util.Log;
import android.content.Context;

import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;

import java.nio.charset.Charset;
import java.util.UUID;

import android.widget.Toast;

public class BleModule extends ReactContextBaseJavaModule {
    // constructor
    public BleModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    // Mandatory function getName that specifies the module name
    @Override
    public String getName() {
        return "BleModule";
    }

    private BluetoothLeAdvertiser advertiser; // for performing BLE advertising operations
    private BluetoothManager mBluetoothManager; // to obtain an instance of device's BT adapter
    private BluetoothGattServer mBluetoothGattServer;

    private ReactApplicationContext reactContext;
    
    /** A BLE Service is defined as fixed structure to which information about
     * a utility shall be bundled. It is analogous to JSON formatting in API exchanges.
     * A Service-UUID is a unique number that identifies services, so as centrals 
     * can inform a peripheral of which services it provides.
     * @see https://devzone.nordicsemi.com/nordic/short-range-guides/b/bluetooth-low-energy/posts/ble-services-a-beginners-tutorial
     */
    private static UUID SERVICE_UUID = UUID.fromString("0000ff01-0000-1000-8000-00805F9B34FB"); //TODO: How was 0xff01 determined?
    private static String device_name = "";

    private void sendEvent(ReactContext reactContext, String eventName, WritableMap params) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(eventName, params);
    }


    // Unused method 
    @ReactMethod // Annotation for exposing Java methods to JS
    public void getDeviceName(Callback getNameCallBack) {
        String currentDeviceName = BluetoothAdapter.getDefaultAdapter().getName();
        getNameCallBack.invoke(currentDeviceName);
    }

    /**
     * Setups preferences, packet-data, scan-response of BLE advertisement, then begins broadcast. 
     * @param   deviceName name of device to be included in advertisement packet.
     * @param   advCallBack JS defined; calls resolve() when invoked with arg0=true.
     *
     * @see https://developer.android.com/reference/android/bluetooth/le/BluetoothLeAdvertiser
     * @see https://reactnative.dev/docs/native-modules-android#callbacks
     */
    @ReactMethod
    public void advertise(String deviceName, Callback advCallBack) {
        // Initialize local device Bluetooth adapter
        BluetoothAdapter bluetoothAdapter = mBluetoothManager.getAdapter();  
        advertiser = bluetoothAdapter.getBluetoothLeAdvertiser(); // object for BLE advertising operations
        if (advertiser == null) {
            Toast.makeText(getReactApplicationContext(), "Failed to create advertiser", Toast.LENGTH_SHORT).show();
            return;
        }

        // Set advertising preferences for the BLE advertiser instance
        AdvertiseSettings advertiseSettings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED) // balance advertising freq and power consumption
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH) // advertise to largest visibility range
                .setConnectable(true).build(); // allow connection establishment with peripheral devices

        // convert device name to array of utf8-bytes, to be included in advert data
        device_name = deviceName;
        String serviceDataString = device_name;
        byte[] serviceData = serviceDataString.getBytes(Charset.forName("UTF-8")); 

        // Populate data packet to be advertised
        AdvertiseData advertiseData = new AdvertiseData.Builder().setIncludeDeviceName(false)
                .addServiceUuid(new ParcelUuid(SERVICE_UUID)) // include Service-UUID; see explanation in declaration above
                .addServiceData(new ParcelUuid(SERVICE_UUID), serviceData) // include deviceName as service data
                .setIncludeTxPowerLevel(true).build(); // include transmission power level (TODO: to estimate distance?)

        // Scan-response data is requested/sent as a 2nd advertising packet to peripherals that were 
        // scanned to have detected the first ad-packet
        AdvertiseData scanResponseData = new AdvertiseData.Builder().setIncludeDeviceName(true).build();
  
        // Wrap AdvertiseCallback with JS defined advCallBack, and Toast/Log message to deliver advert status
        AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                super.onStartSuccess(settingsInEffect);
                // String advString = settingsInEffect.toString() +"\n Service Data \n" +
                // advertiseData.getServiceData().toString()
                // +"\n UUIDs: \n" + advertiseData.getServiceUuids().toString();
                String advString = settingsInEffect.toString() + "\n Advertised Data \n" + advertiseData.toString();
                advCallBack.invoke(true, advString); // in App.js, will lead to resolve()
            }

            @Override
            public void onStartFailure(int errorCode) {
                advCallBack.invoke(false, errorCode); 
                Toast.makeText(getReactApplicationContext(), "Failed to start advertiser.", Toast.LENGTH_SHORT).show();
                super.onStartFailure(errorCode); // in App.js, will lead to .catch(reject()))
            }
        };

        // Begin broadcast
        advertiser.startAdvertising(advertiseSettings, advertiseData, scanResponseData, advertiseCallback);
    }

    /**
     * [someFunction description]
     * @param   srvCallBack [description]
     */
    @ReactMethod
    public void startServer(Callback srvCallBack) {
        mBluetoothGattServer = mBluetoothManager.openGattServer(getReactApplicationContext(), mGattServerCallback);
        if (mBluetoothGattServer == null) {
            srvCallBack.invoke(false);
            return;
        }

        BluetoothGattService gattService = new BluetoothGattService(SERVICE_UUID,
                BluetoothGattService.SERVICE_TYPE_PRIMARY);

        BluetoothGattCharacteristic mCharacteristics = new BluetoothGattCharacteristic(SERVICE_UUID, 2, 1);

        String currentDeviceName = BluetoothAdapter.getDefaultAdapter().getName();

        boolean isCharAdded = gattService.addCharacteristic(mCharacteristics);

        if (isCharAdded == false) {
            Toast.makeText(getReactApplicationContext(), "Can't add characteristics.", Toast.LENGTH_SHORT).show();
        }

        boolean isServAdded = mBluetoothGattServer.addService(gattService);

        if (isServAdded == true) {
            srvCallBack.invoke(true, gattService.getUuid().toString());
            return;
        }
    }

    private BluetoothGattServerCallback mGattServerCallback = new BluetoothGattServerCallback() {
        WritableMap params = Arguments.createMap();

        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {

            if (newState == BluetoothProfile.STATE_CONNECTED) {
                params.putString("msg", "device connected " + device.toString());
                return;
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                params.putString("msg", "device disconnected " + device.toString());
                return;
            }
            sendEvent(reactContext, "forConsoleLogging", params);
        }

        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                BluetoothGattCharacteristic characteristic) {
            super.onCharacteristicReadRequest(device, requestId, offset, characteristic);
            String val = device_name;
            byte[] val_in_bytes = val.getBytes(Charset.forName("UTF-8"));
            mBluetoothGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, val_in_bytes);

            params.putString("msg", "read request response sent to  " + device.toString());
            sendEvent(reactContext, "forConsoleLogging", params);
        };
    };

    /**
     * [someFunction description]
     * @param   successCallback [description]
     */
    @ReactMethod
    public void isAdvertisingSupported(Callback successCallback) {
        if (!BluetoothAdapter.getDefaultAdapter().isMultipleAdvertisementSupported()) {
            Toast.makeText(getReactApplicationContext(), "Turn on bluetooth.", Toast.LENGTH_SHORT).show();
            try {
                successCallback.invoke(false);
            } catch (Exception e) {
                Toast.makeText(getReactApplicationContext(), "Bluetooth Error.", Toast.LENGTH_SHORT).show();
            }
        } else {
            successCallback.invoke(true);
            mBluetoothManager = (BluetoothManager) getReactApplicationContext()
                    .getSystemService(Context.BLUETOOTH_SERVICE);
        }
    }

    private boolean adv = false;
    private boolean srv = false;
    private int err;

    /**
     * [someFunction description]
     * @param   advsrvCallBack [description]
     */
    @ReactMethod
    public void stopBroadcastingGATT(Callback advsrvCallBack) {

        AdvertiseCallback advertisingCallback = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                adv = true;
                super.onStartSuccess(settingsInEffect);
            }

            @Override
            public void onStartFailure(int errorCode) {
                adv = false;
                err = errorCode;
                super.onStartFailure(errorCode);
            }
        };
        if (advertiser == null) {
            adv = true;
        } else {
            advertiser.stopAdvertising(advertisingCallback);
            adv = true;
        }

        if (mBluetoothGattServer == null) {
            srv = true;
        } else {
            mBluetoothGattServer.close();
            srv = true;
        }
        advsrvCallBack.invoke(adv, srv, err);
    }
}
