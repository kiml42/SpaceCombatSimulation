using Assets.Src.Controllers;
using Assets.Src.Evolution;
using Assets.Src.ObjectManagement;
using System;
using UnityEngine;

//TODO neaten up fields and methods.
public class EngineControler : AbstractDeactivatableController
{
    public Transform Pilot;
    public FuelTank FuelTank;
    public Rigidbody ForceApplier;
    public ParticleSystem Plume;

    /// <summary>
    /// The force the engine applys at this transform's position in this transfornm's -up direction
    /// </summary>
    [Tooltip("The force the engine applys at this transform's position in this transfornm's -up direction")]
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

    public bool UseAsTorquer = true;
    public bool UseAsTranslator = true;

    [Tooltip("Fuel used per second at full throttle.")]
    public float FullThrottleFuelConsumption = 1;

    /// <summary>
    /// vector the engine should try to make the pilot turn to face
    /// </summary>
    public Vector3? OrientationVector;

    /// <summary>
    /// Vector the engine should apply forces towards.
    /// </summary>
    public Vector3? PrimaryTranslateVector;

    /// <summary>
    /// Secondarry Vector the engine should apply forces towards.
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

    //public bool DebugMode;
    //public Vector3 TV1;
    //public Vector3 TV2;

    /// <summary>
    /// The world space vector the engine should try to fly towards.
    /// Use null or zero for no force
    /// </summary>
    public Vector3? FlightVector
    {
        set
        {
            OrientationVector = value;
            PrimaryTranslateVector = value;
        }
    }
    
    /// <summary>
    /// Vector of the torque applied to the pilot y this engine.
    /// Calculated if not set (default)
    /// </summary>
    public Vector3? TorqueVector = null;
    
    public float _fullTrhrottlePlumeRate;

    // Use this for initialization
    void Start () { 
        if(Plume != null)
        {
            _fullTrhrottlePlumeRate = Plume.emission.rateOverTime.constant;
        }

        FindOtherComponents(transform);
        
        if(Pilot != transform)
        {
            NotifyPilot();
        }
        //if (FuelTank == null)
        //{
        //    Debug.Log(transform.name + " found no fuel tank - INFINITE FUEL!");
        //}
        if(ForceApplier == null)
        {
            Debug.LogError("Engine found no rigidbody to apply forces to");
        }
        CalculateEngineTorqueVector();
    }
    
    // Update is called once per frame
    void FixedUpdate () {

        //if (DebugMode)
        //{
        //    PrimaryTranslateVector = TV1;
        //    SecondaryTranslateVector = TV2;
        //    TV1 = PrimaryTranslateVector ?? Vector3.zero;
        //}

        //Debug.Log(transform + ":");
        if (_active && HasFuel())
        {
            float throttle = 0;

            if (UseAsTranslator)
            {
                throttle = TranslateThrotleSetting();
            }

            //if(throttle != 0)
            //{
            //    Debug.Log(name + " translate throttle " + throttle);
            //}

            if (UseAsTorquer)
            {
                float additionalThrottle = RotateThrottleSetting();

                //if (additionalThrottle != 0)
                //{
                //    Debug.Log(name + " torque throttle " + additionalThrottle);
                //}

                throttle += additionalThrottle;  //add the additional throttle.
            }
            throttle = Math.Min(1, throttle);  //cut the throttle whole thing down to the propper range.
            
            if(throttle > 0)
            {
                throttle = AdjustThrottleForFuel(throttle);

                ForceApplier.AddForceAtPosition(-transform.up * EngineForce2 * throttle * Time.fixedDeltaTime, transform.position, ForceMode.Force);
                //ForceApplier.AddRelativeForce(EngineForce * throttle);
                SetPlumeState(throttle);
                return;
            }
        }
        SetPlumeState(0);
    }

    private bool HasFuel()
    {
        if(FuelTank != null)
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
        } else {
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
        } else
        {
            //Debug.Log("turning plume off");
            Plume.Stop();
        }
    }

    public override void Deactivate()
    {
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

    private int TorqueThrustDirectionMultiplier()
    {
        if (Pilot != null && Pilot.IsValid() && OrientationVector.HasValue && OrientationVector.Value.magnitude > 0 && TorqueVector.HasValue && TorqueVector.Value.magnitude > 0.5)
        {
            var pilotSpaceVector = Pilot.InverseTransformVector(OrientationVector.Value);

            var rotationVector = new Vector3(-pilotSpaceVector.y, pilotSpaceVector.x, 0);   //set z to 0 to not add spin

            var angle = Vector3.Angle(TorqueVector.Value, rotationVector);

            //Debug.Log("torquer to vector angle: " + angle);
            //Debug.Log(_torqueVector + " - " + FlightVector.Value);
            if(angle < TorqueFireAngle)
            {
                return 1;
            }
            if(angle > 180 - TorqueFireAngle)
            {
                return -1;
            }
        }
        //Debug.Log("vectors not set");
        return 0;
    }

    /// <summary>
    /// Gets the throttle setting appropriate for this engine to apply torqu towards the desired pilot orientation.
    /// </summary>
    /// <returns></returns>
    private float RotateThrottleSetting()
    {
        var thrustDirectionMultiplier = TorqueThrustDirectionMultiplier();
        if (TorquerFullThrottleAngle != 0 && thrustDirectionMultiplier != 0)
        {
            var pilotorientationErrorAngle = Vector3.Angle(Pilot.forward, OrientationVector.Value);

            float additionalThrottle = thrustDirectionMultiplier * (pilotorientationErrorAngle / TorquerFullThrottleAngle);

            return Clamp(additionalThrottle, -1, 1);
        }
        return 0;
    }

    /// <summary>
    /// Returns the unclamped translate throttle calculated from the angle between this engine's line of action and the desired translate vector.
    /// If this is < 0 that implies that this would push away from the intended translate vector, so any additional torquer throttle should be reduced.
    /// If this is > 1 the angle is so close to correct that the torquer angle has to be a strong negative to counter this.
    /// </summary>
    /// <returns></returns>
    private float TranslateThrotleSetting()
    {
        if(TranslateFireAngle > 0 && VectorIsUseful(PrimaryTranslateVector))
        {
            float throttle = 0;
            //the enemy's gate is down
            var primaryAngleError = Vector3.Angle(-transform.up, PrimaryTranslateVector.Value);
            //Debug.Log("fire angle = " + angle);

            if(SecondaryTranslateVector != PrimaryTranslateVector && VectorIsUseful(SecondaryTranslateVector))
            {
                var secondaryAngle = Vector3.Angle(-transform.up, SecondaryTranslateVector.Value);
                var pToSAngle = Vector3.Angle(PrimaryTranslateVector.Value, SecondaryTranslateVector.Value);

                var angleSum = primaryAngleError + secondaryAngle;  //will be = pToSAngle on ark between P & S

                primaryAngleError = (angleSum - pToSAngle)/2;   //set the primaryAngleError to the distance from being on the ark(ish)
                //the maths here isn't quite right, but it'll probably do, it's qualatatively correct. (I hope)
            }
            if(primaryAngleError < TranslateFireAngle)
            {
                throttle = 1 - (primaryAngleError - FullThrottleTranslateFireAngle / TranslateFireAngle - FullThrottleTranslateFireAngle);
            }

            if(primaryAngleError > 180 - FullThrottleTranslateFireAngle)
            {
                throttle = -1;
            }

            //Debug.Log("TranslateThrotleSetting=" + throttle);
            return Clamp(throttle, -1, 1);
        }
        //Debug.Log("No FlightVector set Defaulting To False");
        return 0;
    }

    private void FindOtherComponents(Transform transform)
    {
        //TODO replace this with getComponentInParent() method if possible.
        if(Pilot != null && FuelTank != null && ForceApplier != null)
        {
            //everyhting's set already, so stop looking.
            return;
        }
        if(transform != null)
        {
            if (FuelTank == null)
            {
                //first object found with a fuel tank
                FuelTank = transform.GetComponent<FuelTank>();
            }
            if(ForceApplier == null)
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
            if(parent != null) FindOtherComponents(parent);
        }
    }

    private void NotifyPilot()
    {
        if(Pilot != null)
        {
            //Debug.Log("Registering engine with " + parent);
            Pilot.SendMessage("RegisterEngine", this, SendMessageOptions.DontRequireReceiver);
        }
    }

    private Vector3? CalculateEngineTorqueVector()
    {
        if (Pilot != null && !TorqueVector.HasValue)
        {
            var pilotSpaceVector = Pilot.InverseTransformVector(-transform.up);
            var pilotSpaceEngineLocation = Pilot.InverseTransformPoint(transform.position);
            var xTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.z) - (pilotSpaceEngineLocation.z * pilotSpaceVector.y);
            var yTorque = (pilotSpaceEngineLocation.x * pilotSpaceVector.z) + (pilotSpaceEngineLocation.z * pilotSpaceVector.x);
            var zTorque = (pilotSpaceEngineLocation.y * pilotSpaceVector.x) + (pilotSpaceEngineLocation.x * pilotSpaceVector.y);
            TorqueVector = new Vector3(xTorque, yTorque, zTorque);
        }
        return TorqueVector;
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

    public static float Clamp(float value, float min, float max)
    {
        return (value < min) ? min : (value > max) ? max : value;
    }
}
