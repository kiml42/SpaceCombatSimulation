using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using UnityEngine;

//TODO neaten up fields and methods.
public class EngineControler : AbstractDeactivatableController, ITorquer
{
    public Transform Pilot;
    public FuelTank FuelTank;
    public Rigidbody ForceApplier;
    public ParticleSystem Plume;

    /// <summary>
    /// The force the engine applies at this transform's position in this transfornm's -up direction
    /// </summary>
    [Tooltip("The force the engine applies at this transform's position in this transform's -up direction")]
    public float EngineForce2;
    
    [Tooltip("angle error at which the engine starts to turn on. \n" +
        "Its throttle will be 0 at this angle, and go up towards 1 as the angle decreases to FullThrottleTranslateFireAngle. \n" +
        "0 will disable this engine for translation")]
    public float TranslateFireAngle = 90;

    [Tooltip("Engine will apply full throttle for translation if the angle error is less than this.")]
    public float FullThrottleTranslateFireAngle = 45;

    [Tooltip("Will be used for torque if the angle between this engine's torque vector and the desired torque vector is less than this.")]
    public float TorqueFireAngle = 45;

    [Tooltip("throttle for torquing will be set to angle to turn / TorquerFullThrottleAngle capped at 1.")]
    public float TorquerFullThrottleAngle = 10;

    public bool UseAsTranslator = true;
    public bool UseAsTorquer = true;
    public bool IsActiveTorquer => UseAsTorquer;

    [Tooltip("Fuel used per second at full throttle.")]
    public float FullThrottleFuelConsumption = 1;

    /// <summary>
    /// vector the engine should try to make the pilot turn to face in world space
    /// </summary>
    private Vector3? _desiredTorque;

    /// <summary>
    /// Vector to try to get the pilot's up axis to face in world space.
    /// </summary>
    private float? _torqueWeight;


    /// <summary>
    /// Vector the engine should apply forces towards.
    /// </summary>
    public Vector3? PrimaryTranslateVector;

    /// <summary>
    /// Secondary Vector the engine should apply forces towards.
    /// Engine will fire if it is pointed near the arc between these two vectors.
    /// </summary>
    public Vector3? SecondaryTranslateVector
    {
        get
        {
            return _secondaryTranslateVector;
        }
        set
        {
            _secondaryTranslateVector = value;
            PrimaryTranslateVector = VectorIsUseful(PrimaryTranslateVector) ? PrimaryTranslateVector : value;
        }
    }
    private Vector3? _secondaryTranslateVector;

    public bool DebugMode;
        
    /// <summary>
    /// Vector of the torque applied to the pilot by this engine.
    /// </summary>
    private Vector3? _torqueVector = null;
    public Transform TorqueVectorIndicator;
    
    public float _fullTrhrottlePlumeRate;

    // Use this for initialization
    public void Start () { 
        if(Plume != null)
        {
            _fullTrhrottlePlumeRate = Plume.emission.rateOverTime.constant;
        }

        FindOtherComponents(transform);
        
        //if (FuelTank == null)
        //{
        //    Debug.Log(transform.name + " found no fuel tank - INFINITE FUEL!");
        //}
        if(ForceApplier == null)
        {
            Debug.LogError("Engine found no rigidbody to apply forces to");
        }
        InitialiseEngineTorqueVector();
    }
    
    // Update is called once per frame
    void FixedUpdate ()
    {

        //if (DebugMode)
        //{
        //    PrimaryTranslateVector = TV1;
        //    SecondaryTranslateVector = TV2;
        //    TV1 = PrimaryTranslateVector ?? Vector3.zero;
        //}

        Log($"IsActive: {_active}, HasFuel: {HasFuel()}, UseAsTranslator: {UseAsTranslator}, UseAsTorquer: {UseAsTorquer}");
        if (_active && HasFuel())
        {
            float throttle = 0;

            if (UseAsTranslator)
            {
                throttle = TranslateThrottleSetting();
                Log($"translate throttle {throttle}");
            }

            if (UseAsTorquer)
            {
                float additionalThrottle = TorqueThrottleSetting();

                Log($"torque throttle {additionalThrottle}");

                throttle += additionalThrottle;  //add the additional throttle.
            }

            Log($"net throttle {throttle}");

            throttle = Math.Min(1, throttle);  //cut the throttle whole thing down to the proper range.

            if (throttle > 0)
            {
                throttle = AdjustThrottleForFuel(throttle);
                var force = -transform.up * EngineForce2 * throttle * Time.fixedDeltaTime;

                Log($"applying force {force}");

                ForceApplier.AddForceAtPosition(force, transform.position, ForceMode.Force);
                //ForceApplier.AddRelativeForce(EngineForce * throttle);
                SetPlumeState(throttle);
                return;
            }
        }
        SetPlumeState(0);
    }

    public void SetTorque(Vector3? pilotSpaceTorque)
    {
        _desiredTorque = pilotSpaceTorque;
        _torqueWeight = pilotSpaceTorque?.magnitude;
    }

    public void Activate()
    {
        //TODO
        Log("Activated");
        _active = true;
    }

    public override void Deactivate()
    {
        Log("Deactivated");
        base.Deactivate();
        SetPlumeState(0);
    }
    
    private const float MaxShootAngle = 180;

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        TranslateFireAngle = genomeWrapper.GetScaledNumber(MaxShootAngle);
        TorqueFireAngle = genomeWrapper.GetScaledNumber(MaxShootAngle);
        FullThrottleTranslateFireAngle = genomeWrapper.GetScaledNumber(MaxShootAngle);
        EngineForce2 = genomeWrapper.GetScaledNumber(EngineForce2);

        return genomeWrapper;
    }

    private void Log(string text)
    {
        if (DebugMode)
            Debug.Log($"{name} on {Pilot}. {text}");
    }

    private bool HasFuel()
    {
        if (FuelTank != null)
        {
            return FuelTank.Fuel > 0;
        }
        return true;
    }

    private float AdjustThrottleForFuel(float throttle)
    {
        float actualThrottle;
        if (FuelTank != null)
        {
            //TODO check why this is capped.
            var singleFrameConsumption = Math.Max(FullThrottleFuelConsumption * Time.fixedDeltaTime, 0.0001f);
            var desiredFuel = throttle * singleFrameConsumption;
            var fuel = FuelTank.DrainFuel(desiredFuel);
            actualThrottle = fuel / singleFrameConsumption;
            //Debug.Log("Desired Throttle = " + throttle + ", actualThrottle: " + actualThrottle + ", DesiredFuel: " + desiredFuel + ", actual fuel: " + fuel);
        }
        else
        {
            actualThrottle = throttle;
        }
        return actualThrottle;
    }

    private void SetPlumeState(float throttle)
    {
        if (throttle > 0)
        {
            //Debug.Log("turning plume on");
            Plume.Play();

            //reduce rate for throttle.
            var emission = Plume.emission;
            var rate = emission.rateOverTime;
            rate.constant = _fullTrhrottlePlumeRate * throttle;
            emission.rateOverTime = rate;
        }
        else
        {
            //Debug.Log("turning plume off");
            Plume.Stop();
        }
    }

    /// <summary>
    /// Gets the throttle setting appropriate for this engine to apply torque towards the desired pilot orientation.
    /// </summary>
    /// <returns></returns>
    private float TorqueThrottleSetting()
    {
        if (_desiredTorque.HasValue && _torqueVector.HasValue)
        {
            var angle = Vector3.Angle(_desiredTorque.Value, _torqueVector.Value);

            Log($"_desiredTorque:{_desiredTorque}, _torqueVector:{_torqueVector}, angle:{angle}");
            float throttleForAngle = ThrottleForAngle(angle, TorqueFireAngle, TorquerFullThrottleAngle);
            var throttle = throttleForAngle * _desiredTorque.Value.magnitude;
            Log($"Torque throttle:{throttle}");
            return Clamp(throttle, -1, 1);
        }
        return 0;
    }

    private float ThrottleForAngle(float angle, float zeroThrottleAngle, float fullThrottleAngle)
    {
        return (angle - zeroThrottleAngle) / -fullThrottleAngle;
    }

    /// <summary>
    /// Returns the unclamped translate throttle calculated from the angle between this engine's line of action and the desired translate vector.
    /// If this is < 0 that implies that this would push away from the intended translate vector, so any additional torquer throttle should be reduced.
    /// If this is > 1 the angle is so close to correct that the torquer angle has to be a strong negative to counter this.
    /// </summary>
    /// <returns></returns>
    private float TranslateThrottleSetting()
    {
        Log($"TranslateFireAngle: {TranslateFireAngle}, PrimaryTranslateVector: {PrimaryTranslateVector}, SecondaryTranslateVector: {SecondaryTranslateVector}");
        if(TranslateFireAngle > 0 && VectorIsUseful(PrimaryTranslateVector))
        {
            //the enemy's gate is down
            var primaryAngleError = Vector3.Angle(-transform.up, PrimaryTranslateVector.Value);

            if (SecondaryTranslateVector != PrimaryTranslateVector && VectorIsUseful(SecondaryTranslateVector))
            {
                var secondaryAngle = Vector3.Angle(-transform.up, SecondaryTranslateVector.Value);
                var pToSAngle = Vector3.Angle(PrimaryTranslateVector.Value, SecondaryTranslateVector.Value);

                var angleSum = primaryAngleError + secondaryAngle;  //will be = pToSAngle on ark between P & S

                primaryAngleError = (angleSum - pToSAngle)/2;   //set the primaryAngleError to the distance from being on the ark(ish)
                //the maths here isn't quite right, but it'll probably do, it's qualatatively correct. (I hope)
            }

            float throttle = ThrottleForAngle(primaryAngleError, TorqueFireAngle, TorquerFullThrottleAngle);

            return Clamp(throttle, -1, 1);
        }
        return 0;
    }

    private void FindOtherComponents(Transform transform)
    {
        //TODO replace this with getComponentInParent() method if possible.
        if ((transform == null) || (Pilot != null && FuelTank != null && ForceApplier != null))
        {
            // either the given transform is null or everything's set already, so stop looking.
            return;
        }

        if (FuelTank == null)
        {
            //first object found with a fuel tank
            FuelTank = transform.GetComponent<FuelTank>();
        }
        if (ForceApplier == null)
        {
            //firstComponent with a rigidbody
            ForceApplier = transform.GetComponent<Rigidbody>();
        }
        var parent = transform.parent;
        if (parent == null && Pilot == null)
        {
            //pilot is highest in hierarchy
            Pilot = transform;
        }
        if (parent != null) FindOtherComponents(parent);
    }

    private void InitialiseEngineTorqueVector()
    {
        if (Pilot != null && UseAsTorquer)
        {
            var pilotSpaceVector = Pilot.InverseTransformVector(-transform.up);
            var pilotSpaceEngineLocation = Pilot.InverseTransformPoint(transform.position);
            var xTorque = (pilotSpaceEngineLocation.z * pilotSpaceVector.y) - (pilotSpaceEngineLocation.y * pilotSpaceVector.z);
            var yTorque = (pilotSpaceEngineLocation.x * pilotSpaceVector.z) - (pilotSpaceEngineLocation.z * pilotSpaceVector.x);
            var zTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.x) - (pilotSpaceEngineLocation.x * pilotSpaceVector.y);
            _torqueVector = new Vector3(xTorque, yTorque, zTorque);
            //_torqueVector = new Vector3(0, 0, zTorque);
            if(TorqueVectorIndicator != null)
            {
                var worldTorque = Pilot.TransformVector(_torqueVector.Value);
                TorqueVectorIndicator.rotation = Quaternion.LookRotation(worldTorque);
                var scale = worldTorque.magnitude / 30;
                TorqueVectorIndicator.localScale = new Vector3(scale, scale, scale);
            }
        }
        else
        {
            if (TorqueVectorIndicator != null)
                TorqueVectorIndicator.localScale = Vector3.zero;
        }
    }

    /// <summary>
    /// returns true if the vector is not null and is not zero.
    /// </summary>
    /// <param name="vector"></param>
    /// <returns></returns>
    private bool VectorIsUseful(Vector3? vector)
    {
        return vector.HasValue && vector.Value.magnitude > 0;
    }

    private static float Clamp(float value, float min, float max)
    {
        return (value < min) ? min : (value > max) ? max : value;
    }
}
