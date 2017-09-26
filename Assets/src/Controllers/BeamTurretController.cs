using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using Assets.Src.Targeting.TargetPickers;
using Assets.Src.Turret;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class BeamTurretController : MonoBehaviour, ITurretController, IDeactivatable
{
    public TargetChoosingMechanism TargetChoosingMechanism;
    public Transform RestTarget;
    public int LoadTime = 50;
    public int ShootTime = 200;
    public int StartOffset = 10;
    public float ShootAngle = 5;
    public float BeamForce = 0;
    public float BeamDamage = 10;
    public Transform HitEffect;

    public Rigidbody TurnTable;
    public Rigidbody ElevationHub;
    public Transform BeamsParent;
    private List<Beam> _beams;
    
    private ITurretTurner _turner;
    private IFireControl _fireControl;

    private bool _onInPrevFrame = false;
    private bool _active = true;

    private string InactiveTag = "Untagged";
    
    public float InitialRadius = 1;
    public float Divergence = 0.0005f;
    
    private ITurretRunner _runner;
    public Color BeamColour;

    // Use this for initialization
    void Start()
    {
        var rigidbody = GetComponent<Rigidbody>();
        var emitterCount = BeamsParent.childCount;

        _beams = new List<Beam>();
        for (int i = 0; i < emitterCount; i++)
        {
            var beam = BeamsParent.GetChild(i);
            beam.localScale = Vector3.zero;
            beam.SetColor(BeamColour);
            _beams.Add(new Beam(beam, ShootTime, LoadTime)
            {
                BeamForce = BeamForce,
                HitEffect = HitEffect,
                BeamDamage = BeamDamage,
                FriendlyTag = tag,
                InitialRadius = InitialRadius,
                Divergence = Divergence
            });
        }

        _turner = new UnityTurretTurner(rigidbody, TurnTable, ElevationHub, RestTarget, null);

        _fireControl = new UnityFireControl(this, ElevationHub.transform, ShootAngle);

        _runner = new TurretRunner(TargetChoosingMechanism, _turner, _fireControl)
        {
            name = transform.name
        };
    }

    // Update is called once per frame
    void Update()
    {
        if (_active && _runner != null && _beams != null)
        {
            _runner.RunTurret();
        }
        else
        {
            foreach (var beam in _beams)
            {
                beam.TurnOff();
            }
            //scrub the list now they've all been turned off.
            _beams = new List<Beam>();
        }
    }

    public void Shoot(bool shouldShoot)
    {
        if (_active)
        {
            var shouldTurnOn = shouldShoot & TurnTable != null && ElevationHub != null;
            var i = 0;
            foreach (var beam in _beams)
            {
                if (shouldTurnOn)
                {
                    if (!_onInPrevFrame)
                    {
                        beam.ForceReload(i * StartOffset);
                    }
                    beam.TurnOn();
                }
                else
                {
                    beam.TurnOff();
                }
                i++;
            }
            _onInPrevFrame = shouldTurnOn;
        }
    }

    public void Deactivate()
    {
        Destroy(TurnTable);
        _active = false;
        if(_beams != null)
        {
            foreach (var beam in _beams)
            {
                beam.TurnOff();
                if(beam.Transform.IsValid())
                    Destroy(beam.Transform.gameObject);
            }
        }
        //scrub the list now they've all been turned off.
        _beams = new List<Beam>();

        //Debug.Log("Deactivating " + name);
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
        if(jointedObject != null)
        {
            var hinge = jointedObject.GetComponent("HingeJoint") as HingeJoint;
            if(hinge!= null)
            {
                GameObject.Destroy(hinge);
            }
            jointedObject.transform.parent = null;
        }
    }
}