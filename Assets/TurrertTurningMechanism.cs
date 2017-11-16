using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TurrertTurningMechanism : MonoBehaviour {
    private IKnowsCurrentTarget _targetChoosingMechanism;
    public Transform RestTarget;

    public Rigidbody TurnTable;
    public Rigidbody ElevationHub;
    private bool _active = true;

    private ITurretTurner _turner;

    private string InactiveTag = "Untagged";

    private ITurretRunner _runner;

    public float TurnTableMotorFoce = 30;
    public float TurnTableMotorSpeedMultiplier = 500;
    public float TurnTableParentCancelationFactor = 10;

    public float ElevationHubMotorFoce = 30;
    public float ElevationHubMotorSpeedMultiplier = 500;
    public float EHParentCancelationFactor = 10;

    // Use this for initialization
    void Start()
    {
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        var speedKnower = GetComponent("IKnowsProjectileSpeed") as IKnowsProjectileSpeed;
        var projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
        var rigidbody = GetComponent<Rigidbody>();

        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, projectileSpeed)
        {
            TurnTableMotorForce = TurnTableMotorFoce,
            TurnTableMotorSpeedMultiplier = TurnTableMotorSpeedMultiplier,
            TurnTableParentCancelationFactor = TurnTableParentCancelationFactor,
            ElevationHubMotorForce = ElevationHubMotorFoce,
            ElevationHubMotorSpeedMultiplier = ElevationHubMotorSpeedMultiplier,
            EHParentCancelationFactor = EHParentCancelationFactor
        };

        _runner = new TurretRunner(_targetChoosingMechanism, _turner);
    }

    // Update is called once per frame
    void Update()
    {
        if (_active)
            _runner.RunTurret();
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
        if(ElevationHub != null)
        {
            ElevationHub.tag = InactiveTag;
        }
        if (TurnTable != null)
        {
            TurnTable.tag = InactiveTag;
        }
    }

    public void DieNow()
    {
        Deactivate();
        DestroyJoint(ElevationHub);
        DestroyJoint(TurnTable);
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
}
