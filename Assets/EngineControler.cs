using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

//TODO neaten up fields and methods.
public class EngineControler : MonoBehaviour {
    public Vector3 EngineForce;
    public Rigidbody ForceApplier;
    public ParticleSystem Plume;
    private bool _active = true;
    private string InactiveTag = "Untagged";
    public float TranslateFireAngle = 45;
    public float TorqueFireAngle = 90;

    public bool UseAsTorquer = true;
    public bool UseAsTranslator = true;

    public float FullThrottleFuelConsumption = 1;

    /// <summary>
    /// The world space vector the engine should try to fly towards.
    /// Use null or zero for no force
    /// </summary>
    public Vector3? FlightVector;
    
    private FuelTank _fuelTank;

    // Use this for initialization
    void Start () {        
        _pilot = FindOldestParentAndFuelTank(transform);
        
        if(_pilot != transform)
        {
            NotifyParent();
        }
        if (_fuelTank == null)
        {
            Debug.LogWarning(transform.name + " found no fuel tank - INFINITE FUEL!");
        }
        CalculateEngineTorqueVector();
    }
    
    // Update is called once per frame
    void Update () {
        //Debug.Log(transform + ":");
        if (_active && HasFuel())
        {
            float throttle = 0;

            if (UseAsTranslator)
            {
                throttle = TranslateThrotleSetting();
            }

            if (UseAsTorquer && throttle < 1 && ApplysCorrectTorque())
            {
                var angle = Vector3.Angle(_pilot.forward, FlightVector.Value);
                var additionalThrottle = angle / TorquerFullThrottleAngle;
                throttle = Math.Min(throttle + additionalThrottle, 1);
            }

            if(throttle > 0)
            {
                throttle = AdjustThrottleForFuel(throttle);
                
                ForceApplier.AddRelativeForce(EngineForce * throttle);
                if(throttle > 0.3)
                {
                    SetPlumeState(true);
                    return;
                }
            }
        }
        SetPlumeState(false);
    }

    private bool HasFuel()
    {
        if(_fuelTank != null)
        {
            return _fuelTank.Fuel > 0;
        }
        return true;
    }

    private float AdjustThrottleForFuel(float throttle)
    {
        if(_fuelTank != null)
        {
            var fuel = _fuelTank.DrainFuel(throttle * FullThrottleFuelConsumption);
            throttle = fuel * FullThrottleFuelConsumption;
        }
        return throttle;
    }

    public Vector3 _torqueVector;
    private Transform _pilot;

    /// <summary>
    /// throttle for torquing will be set to angle to turn / TorquerFullThrottleAngle capped at 1.
    /// </summary>
    public float TorquerFullThrottleAngle = 10;

    private void SetPlumeState(bool on)
    {
        if (on)
        {
            //Debug.Log("turning plume on");
            Plume.Play();
        } else
        {
            //Debug.Log("turning plume off");
            Plume.Stop();
        }
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        SetPlumeState(false);
        tag = InactiveTag;
    }

    private bool ApplysCorrectTorque()
    {
        if (FlightVector.HasValue && FlightVector.Value.magnitude > 0 && _torqueVector.magnitude > 0.5)
        {
            var pilotSpaceVector = _pilot.InverseTransformVector(FlightVector.Value);

            var rotationVector = new Vector3(-pilotSpaceVector.y, pilotSpaceVector.x, 0);   //set z to 0 to not add spin

            var angle = Vector3.Angle(_torqueVector, rotationVector);

            //Debug.Log("torquer to vector angle: " + angle);
            //Debug.Log(_torqueVector + " - " + FlightVector.Value);
            return angle < TorqueFireAngle;
        }
        //Debug.Log("vectors not set");
        return false;
    }

    private float TranslateThrotleSetting()
    {
        if(FlightVector.HasValue && FlightVector.Value.magnitude > 0)
        {
            //the enemy's gate is down
            var angle = Vector3.Angle(-transform.up, FlightVector.Value);
            //Debug.Log("fire angle = " + angle);

            var throttle = Math.Max(0, 1 - (angle / TranslateFireAngle));
            //Debug.Log("TranslateThrotleSetting=" + throttle);
            return throttle;
        }
        //Debug.Log("No FlightVector set Defaulting To False");
        return 0;
    }

    private Transform FindOldestParentAndFuelTank(Transform transform)
    {
        if (_fuelTank == null)
        {
            _fuelTank = transform.GetComponent("FuelTank") as FuelTank;
        }
        var parent = transform.parent;
        if (parent == null)
        {
            return transform;
        }
        return FindOldestParentAndFuelTank(parent);
    }

    private void NotifyParent()
    {
        //Debug.Log("Registering engine with " + parent);
        _pilot.SendMessage("RegisterEngine", this, SendMessageOptions.DontRequireReceiver);
    }

    private Vector3 CalculateEngineTorqueVector()
    {
        var pilotSpaceVector = _pilot.InverseTransformVector(-transform.up);
        var pilotSpaceEngineLocation = _pilot.InverseTransformPoint(transform.position);
        var xTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.z) - (pilotSpaceEngineLocation.z * pilotSpaceVector.y);
        var yTorque = (pilotSpaceEngineLocation.x * pilotSpaceVector.z) + (pilotSpaceEngineLocation.z * pilotSpaceVector.x);
        var zTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.x) + (pilotSpaceEngineLocation.x * pilotSpaceVector.y);
        _torqueVector = new Vector3(xTorque, yTorque, zTorque);
        return _torqueVector;
    }
}
