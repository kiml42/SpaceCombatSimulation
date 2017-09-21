using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EngineControler : MonoBehaviour {
    public Vector3 EngineForce;
    public Rigidbody ForceApplier;
    public ParticleSystem Plume;
    private bool _active = true;
    private string InactiveTag = "Untagged";
    public float FireAngle = 10;

    public bool UseAsTorquer = true;
    public bool UseAsTranslator = true;

    /// <summary>
    /// The world space vector the engine should try to fly towards.
    /// Use null or zero for no force
    /// </summary>
    public Vector3? FlightVector;

    // Use this for initialization
    void Start () {        
        _pilot = FindOldestParent(transform);
        
        if(_pilot != transform)
        {
            NotifyParent();
        }
        CalculateEngineTorqueVector();
    }

    private Transform FindOldestParent(Transform transform)
    {
        var parent = transform.parent;
        if(parent == null)
        {
            return transform;
        }
        return FindOldestParent(parent);
    }

    private void NotifyParent()
    {
        //Debug.Log("Registering engine with " + parent);
        _pilot.SendMessage("RegisterEngine", transform, SendMessageOptions.DontRequireReceiver);
    }
    
    // Update is called once per frame
    void Update () {
        Debug.Log(transform + ":");
        if (_active)
        {
            var translateOn = UseAsTranslator && IsAimedAtFlightVector();
            var torqueOn = UseAsTorquer && ApplysCorrectTorque();
            Debug.Log(torqueOn);

            if (translateOn || torqueOn)
            {
                SetPlumeState(true);
                ForceApplier.AddRelativeForce(EngineForce);
            } else
            {
                SetPlumeState(false);
            }
        }
    }
    
    public Vector3 _torqueVector;
    private Transform _pilot;

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

            Debug.Log("torquer to vector angle: " + angle);
            Debug.Log(_torqueVector + " - " + FlightVector.Value);
            return angle < 90;
        }
        Debug.Log("vectors not set");
        return false;
    }

    private bool IsAimedAtFlightVector()
    {
        if(FlightVector.HasValue && FlightVector.Value.magnitude > 0)
        {
            //the enemy's gate is down
            var angle = Vector3.Angle(-transform.up, FlightVector.Value);
            Debug.Log("fire angle = " + angle);
            return angle < FireAngle;
        }
        Debug.Log("No FlightVector set Defaulting To False");
        return false;
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
