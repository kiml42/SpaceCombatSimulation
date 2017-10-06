using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnProjectile : MonoBehaviour, IKnowsEnemyTags, IDeactivatable
{
    private IKnowsCurrentTarget _targetChoosingMechanism;
    public bool TagChildren = false;
    public Rigidbody Projectile;
    public Transform Emitter;
    private Rigidbody _spawner;
    
    public float RandomStartTime = 30;
    public int MinStartTime = 30;
    private bool _active = true;

    public int BurstCount = 1;
    private int _projectilesThisBurst = 0;
    public int BurstInterval = 1;


    #region EnemyTags
    public void AddEnemyTag(string newTag)
    {
        var tags = EnemyTags.ToList();
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    public void SetEnemyTags(List<string> allEnemyTags)
    {
        EnemyTags = allEnemyTags;
    }

    public List<string> GetEnemyTags()
    {
        return EnemyTags;
    }

    public List<string> EnemyTags;
    #endregion

    public Vector3 Velocity = new Vector3(0, 0, 10);
    public float RandomSpeed = 1;

    private int _reload = 0;
    public int LoadTime = 200;

    private string InactiveTag = "Untagged";
    private ColourSetter _colerer;

    // Use this for initialization
    void Start()
    {
        _colerer = GetComponent("ColourSetter") as ColourSetter;
        _reload = (int)(UnityEngine.Random.value * RandomStartTime) + MinStartTime;
        Emitter = Emitter ?? transform;
        _targetChoosingMechanism = GetComponent("IKnowsCurrentTarget") as IKnowsCurrentTarget;
                
        _spawner = GetComponent("Rigidbody") as Rigidbody;
    }

    // Update is called once per frame
    void Update()
    {
        if (_active)
            if (_reload <= 0 && ShouldShoot())
            {
                var projectile = Instantiate(Projectile, Emitter.position, Emitter.rotation);

                //Debug.Log("Velocity " + Velocity);
                Vector3 velocity = Emitter.TransformVector(Velocity);
                //velocity = Velocity.magnitude * Emitter.transform.forward;
                //Debug.Log("velocity " + velocity);

                if (_spawner != null)
                {
                    velocity = velocity + _spawner.velocity;
                }

                velocity += RandomSpeed * UnityEngine.Random.insideUnitSphere;

                projectile.velocity = velocity;

                projectile.SendMessage("SetEnemyTags", EnemyTags, SendMessageOptions.DontRequireReceiver);
                if (TagChildren) { projectile.tag = tag; }

                if (_colerer != null)
                {
                    //Debug.Log("has renderer");
                    projectile.transform.SetColor(_colerer.Colour);
                }

                _projectilesThisBurst++;
                var stilBursting = _projectilesThisBurst < BurstCount;
                _projectilesThisBurst = stilBursting ? _projectilesThisBurst : 0;

                _reload = stilBursting ? BurstInterval :LoadTime;
            }
            else
            {
                _reload--;
            }
    }

    private bool ShouldShoot()
    {
        if (_targetChoosingMechanism != null)
        {
            return _targetChoosingMechanism.CurrentTarget != null;
        }
        return true;
    }

    public void Deactivate()
    {
        //Debug.Log("Deactivating " + name);
        _active = false;
        tag = InactiveTag;
    }
}
