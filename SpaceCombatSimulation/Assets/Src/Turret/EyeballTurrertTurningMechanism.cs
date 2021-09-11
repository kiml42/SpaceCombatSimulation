using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.Targeting;
using UnityEngine;

public class EyeballTurrertTurningMechanism : GeneticConfigurableMonobehaviour
{
    private IKnowsCurrentTarget _targetChoosingMechanism;
    public Transform RestTarget;

    public Rigidbody Ball;
    private bool _active = true;

    private ITurretTurner _turner;

    private ITurretRunner _runner;

    public float MotorForce = 30;

    public Transform VectorArrow;

    // Use this for initialization
    void Start()
    {
        _targetChoosingMechanism = GetComponent<IKnowsCurrentTarget>();
        var speedKnower = GetComponent<IKnowsProjectileSpeed>();
        var projectileSpeed = speedKnower?.KnownProjectileSpeed;
        var rigidbody = GetComponent<Rigidbody>();

        _turner = new EyeballTurretTurner(rigidbody, Ball, RestTarget, projectileSpeed)
        {
            Torque = MotorForce,
            VectorArrow = VectorArrow
        };

        _runner = new TurretRunner(_targetChoosingMechanism, _turner);
    }

    // Update is called once per frame
    void FixedUpdate()
    {
        if (_active)
            _runner.RunTurret();
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
    }

    public void DieNow()
    {
        Deactivate();
        DestroyJoint(Ball);
        //Don't remove the turret itself, that will be done by the thing calling DieNow (which can't tell that DieNow exists)
    }

    private void DestroyJoint(Rigidbody jointedObject)
    {
        if (jointedObject != null)
        {
            var hinge = jointedObject.GetComponent<HingeJoint>();
            if (hinge != null)
            {
                GameObject.Destroy(hinge);
            }
            jointedObject.transform.parent = null;
        }
    }

    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        MotorForce = genomeWrapper.GetScaledNumber(MotorForce * 2);
        return genomeWrapper;
    }
}
