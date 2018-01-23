using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EyeballTurrertTurningMechanism : MonoBehaviour, IGeneticConfigurable
{
    private IKnowsCurrentTarget _targetChoosingMechanism;
    public Transform RestTarget;

    public Rigidbody Ball;
    private bool _active = true;

    private ITurretTurner _turner;

    private string InactiveTag = "Untagged";

    private ITurretRunner _runner;

    public float MotorForce = 30;
    public float MotorSpeedMultiplier = 500;
    public float MotorSpeedCap = 100;

    // Use this for initialization
    void Start()
    {
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        var speedKnower = GetComponent("IKnowsProjectileSpeed") as IKnowsProjectileSpeed;
        var projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
        var rigidbody = GetComponent<Rigidbody>();

        _turner = new EyeballTurretTurner(rigidbody, Ball, RestTarget, projectileSpeed)
        {
            Torque = MotorForce,
            SpeedMultiplier = MotorSpeedMultiplier,
            SpeedCap = MotorSpeedCap
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
        tag = InactiveTag;
        if(Ball != null)
        {
            Ball.tag = InactiveTag;
        }
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
            var hinge = jointedObject.GetComponent("HingeJoint") as HingeJoint;
            if (hinge != null)
            {
                GameObject.Destroy(hinge);
            }
            jointedObject.transform.parent = null;
        }
    }

    public bool GetConfigFromGenome = true;

    public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            MotorForce = genomeWrapper.GetScaledNumber(600);
            MotorSpeedMultiplier = genomeWrapper.GetScaledNumber(300);
            MotorSpeedCap = genomeWrapper.GetScaledNumber(100);
        }

        return genomeWrapper;
    }
}
