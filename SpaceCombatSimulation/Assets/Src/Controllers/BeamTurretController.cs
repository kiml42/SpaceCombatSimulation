using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Turret;
using System.Collections.Generic;
using UnityEngine;

public class BeamTurretController : MonoBehaviour, ITurretController, IDeactivatable, IKnowsProjectileSpeed
{
    public float LoadTime = 50;
    public float ShootTime = 200;
    public float StartOffset = 10;
    public float BeamForce = 0;
    public float BeamDamage = 10;
    public LampAndParticlesEffectController HitEffectPrefab;
    private readonly float EffectRepeatTime = 0.1f;

    public Rigidbody ElevationHub;
    public Transform BeamsParent;
    private List<Beam> _beams;

    private IFireControl _fireControl;

    private bool _onInPrevFrame = false;
    private bool _active = true;

    private const string InactiveTag = "Untagged";
    
    public float InitialRadius = 1;
    public float Divergence = 0.0005f;
    
    public Color BeamColour;

    [Tooltip("extra seconds to keep shooting after trigger says to stop - emulates slower control mechanism")]
    public float KeepShootingSeconds = 1;
    private float _shootingTime = 0;

    public float? KnownProjectileSpeed
    {
        get
        {
            return null;
        }
    }

    // Use this for initialization
    void Start()
    {
        var emitterCount = BeamsParent.childCount;
        _beams = new List<Beam>();
        for (int i = 0; i < emitterCount; i++)
        {
            var beam = BeamsParent.GetChild(i);
            _beams.Add(new Beam(beam, ShootTime, LoadTime, BeamColour, HitEffectPrefab)
            {
                BeamForce = BeamForce,
                EffectRepeatTime = EffectRepeatTime,
                BeamDamage = BeamDamage,
                FriendlyTag = tag,
                InitialRadius = InitialRadius,
                Divergence = Divergence
            });
        }

        _fireControl = GetComponent<IFireControl>();
    }

    // FixedUpdate is called once per phisics time step
    void FixedUpdate()
    {
        if (_active && _fireControl != null && _beams != null)
        {
            _shootingTime = _fireControl.ShouldShoot() ? KeepShootingSeconds : _shootingTime -= Time.fixedDeltaTime;
            Shoot(_shootingTime >= 0);
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

    //Update is run once per graphics frame
    void Update()
    {
        foreach (var beam in _beams)
        {
            beam.Redraw();
        }
    }

    public void Shoot(bool shouldShoot)
    {
        if (_active)
        {
            var shouldTurnOn = shouldShoot && ElevationHub != null;
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
        _active = false;
        if(_beams != null)
        {
            foreach (var beam in _beams)
            {
                beam.TurnOff();
                if(beam.RayCaster.IsValid())
                    Destroy(beam.RayCaster.gameObject);
            }
        }
        //scrub the list now they've all been turned off.
        _beams = new List<Beam>();

        //Debug.Log("Deactivating " + name);
        tag = InactiveTag;
    }
}