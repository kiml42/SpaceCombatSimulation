﻿using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TurrertTurningMechanism : MonoBehaviour, IGeneticConfigurable
{
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
    public float TurnTableMotorSpeedCap = 100;

    public float ElevationHubMotorFoce = 30;
    public float ElevationHubMotorSpeedMultiplier = 500;
    public float ElevationHubMotorSpeedCap = 100;

    // Use this for initialization
    void Start()
    {
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
        var speedKnower = GetComponent("IKnowsProjectileSpeed") as IKnowsProjectileSpeed;
        var projectileSpeed = speedKnower != null ? speedKnower.ProjectileSpeed : null;
        var rigidbody = GetComponent<Rigidbody>();

        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, projectileSpeed)
        {
            TurnTableTorque = TurnTableMotorFoce,
            TurnTableSpeedMultiplier = TurnTableMotorSpeedMultiplier,
            TurnTableSpeedCap = TurnTableMotorSpeedCap,
            EHTorque = ElevationHubMotorFoce,
            EHSpeedMultiplier = ElevationHubMotorSpeedMultiplier,
            EHSpeedCap = ElevationHubMotorSpeedCap
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

    public bool GetConfigFromGenome = true;

    public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
    {
        if (GetConfigFromGenome)
        {
            genomeWrapper.Jump();
            TurnTableMotorFoce = genomeWrapper.GetScaledNumber(600);
            TurnTableMotorSpeedMultiplier = genomeWrapper.GetScaledNumber(300);
            TurnTableMotorSpeedCap = genomeWrapper.GetScaledNumber(100);
            ElevationHubMotorFoce = genomeWrapper.GetScaledNumber(600);
            ElevationHubMotorSpeedMultiplier = genomeWrapper.GetScaledNumber(300);
            ElevationHubMotorSpeedCap = genomeWrapper.GetScaledNumber(100);
            genomeWrapper.JumpBack();
        }

        return genomeWrapper;
    }
}
