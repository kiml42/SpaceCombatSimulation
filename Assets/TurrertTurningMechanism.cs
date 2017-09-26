using Assets.Src.Interfaces;
using Assets.Src.Targeting;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class TurrertTurningMechanism : MonoBehaviour {
    public TargetChoosingMechanism TargetChoosingMechanism;
    public Transform RestTarget;
    private IKnowsProjectileSpeed _speedKnower;

    public Rigidbody TurnTable;
    public Rigidbody ElevationHub;
    private bool _active = true;

    private ITurretTurner _turner;

    private string InactiveTag = "Untagged";

    private ITurretRunner _runner;
    
    // Use this for initialization
    void Start()
    {
        _speedKnower = GetComponent<IKnowsProjectileSpeed>();
        var rigidbody = GetComponent<Rigidbody>();

        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, _speedKnower.ProjectileSpeed);

        _runner = new TurretRunner(TargetChoosingMechanism, _turner);
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
